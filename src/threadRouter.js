const { createHash, randomUUID } = require('node:crypto');
const { ChannelType, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { GROUPS, groupFor } = require('./vivillonGroups');
const LOCK = 7260516;
const idValid = value => typeof value === 'string' && /^\d{17,20}$/.test(value);
function validateConfig(configs) {
  if (!Array.isArray(configs)) throw Error('Thread routing configuration must be an array');
  const guilds = new Set();
  for (const config of configs) {
    if (!idValid(config.guildId) || guilds.has(config.guildId)) throw Error('Invalid or duplicate routing server');
    guilds.add(config.guildId);
    if (!config.threads || typeof config.threads !== 'object' || Array.isArray(config.threads)) throw Error('Missing group thread map');
    const destinations = new Set();
    for (const [group, id] of Object.entries(config.threads)) {
      if (!Object.hasOwn(GROUPS, group) || !idValid(id) || destinations.has(id)) throw Error('Invalid or duplicate group destination');
      destinations.add(id);
    }
  }
  return configs;
}
// Only presentation data participates: a main-feed bump changes message/timestamps,
// but should not edit, repost or mark the stable group-thread representation.
function fingerprint(profile) {
  const fields = ['discord_user_id', 'discord_tag', 'pokemon_username', 'trainer_code_raw',
    'trainer_code_formatted', 'additional_codes', 'campfire_username', 'vivillon_pattern',
    'publish_to_followers', 'personal_message', 'wanted_regions', 'personal_message_hidden'];
  return createHash('sha256').update(JSON.stringify(fields.map(key => profile[key] ?? null))).digest('hex');
}
function createThreadRouter({ pool, client, configs, loadProfiles, render, logger = console, now = () => new Date() }) {
  configs = structuredClone(validateConfig(configs));
  let running = false;
  const blockedUntil = new Map();
  async function initialize() {
    await pool.query(`CREATE TABLE IF NOT EXISTS poke_post_thread_posts (
      guild_id TEXT NOT NULL, discord_user_id TEXT NOT NULL, thread_id TEXT NOT NULL,
      message_id TEXT, content_hash TEXT, delivery_nonce TEXT NOT NULL,
      attempted_at TIMESTAMPTZ, checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(guild_id,discord_user_id))`);
  }
  async function threadFor(guild, id, writable) {
    const thread = await guild.channels.fetch(id);
    if (!thread || thread.guildId !== guild.id || ![ChannelType.PublicThread, ChannelType.AnnouncementThread].includes(thread.type)) {
      throw Error('Destination must be an existing public thread in this server');
    }
    const me = guild.members.me || await guild.members.fetchMe();
    const permissions = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory];
    if (writable) permissions.push(PermissionFlagsBits.SendMessagesInThreads);
    if (!thread.permissionsFor(me)?.has(permissions)) throw Error('Missing thread access');
    if (writable && thread.locked) throw Error('Destination is locked; moderator action required');
    return thread;
  }
  async function existingMessage(thread, id) {
    if (!id) return null;
    try {
      const message = await thread.messages.fetch(id);
      if (message.author.id !== client.user.id) throw Error('Stored message is not authored by this bot');
      return message;
    } catch (error) { if (error.code === 10008) return null; throw error; }
  }
  async function removeMessage(guild, state) {
    if (!state.message_id) {
      if (state.attempted_at) throw Error('Unconfirmed thread delivery requires inspection before removal');
      return;
    }
    let thread;
    try { thread = await threadFor(guild, state.thread_id, false); }
    catch (error) { if (error.code === 10003) return; throw error; }
    const message = await existingMessage(thread, state.message_id);
    if (message) await message.delete().catch(error => { if (error.code !== 10008) throw error; });
  }
  async function sync(db, job) {
    const { config, profile } = job;
    let { state } = job;
    const userId = profile?.discord_user_id || state.discord_user_id;
    const guild = await client.guilds.fetch(config.guildId);
    if (guild.id !== config.guildId) throw Error('Wrong routing server');
    const target = profile ? config.threads[groupFor(profile.vivillon_pattern)] : null;
    if (!target) {
      if (state) {
        await removeMessage(guild, state);
        await db.query('DELETE FROM poke_post_thread_posts WHERE guild_id=$1 AND discord_user_id=$2', [config.guildId,userId]);
      }
      return;
    }
    // Validate destination before retiring a previous group post.
    const thread = await threadFor(guild, target, true);
    if (state && state.thread_id !== target) {
      await removeMessage(guild, state);
      await db.query('DELETE FROM poke_post_thread_posts WHERE guild_id=$1 AND discord_user_id=$2', [config.guildId,userId]);
      state = null;
    }
    if (!state) {
      state = (await db.query(`INSERT INTO poke_post_thread_posts
        (guild_id,discord_user_id,thread_id,delivery_nonce) VALUES($1,$2,$3,$4) RETURNING *`,
      [config.guildId,userId,target,randomUUID().replaceAll('-','').slice(0,25)])).rows[0];
    }
    const body = await render(profile);
    const payload = { ...body, allowedMentions: { parse: [] } };
    const message = await existingMessage(thread, state.message_id);
    if (thread.archived) await thread.setArchived(false, 'Update configured Poké-Post group feed');
    let messageId;
    if (message) {
      await message.edit(payload);
      messageId = message.id;
    } else {
      // Persist delivery identity before calling Discord. On ambiguous older sends,
      // stop for inspection rather than risk duplicating a post outside nonce TTL.
      if (state.attempted_at && !state.message_id && now() - new Date(state.attempted_at) > 120000) {
        throw Error('Unconfirmed thread delivery requires inspection before retry');
      }
      if (state.message_id) {
        state.delivery_nonce = randomUUID().replaceAll('-','').slice(0,25);
        await db.query(`UPDATE poke_post_thread_posts SET message_id=NULL,delivery_nonce=$3,attempted_at=NULL
          WHERE guild_id=$1 AND discord_user_id=$2`, [config.guildId,userId,state.delivery_nonce]);
      }
      await db.query(`UPDATE poke_post_thread_posts SET attempted_at=COALESCE(attempted_at,$3)
        WHERE guild_id=$1 AND discord_user_id=$2`, [config.guildId,userId,now()]);
      const sent = await thread.send({ ...payload, flags: MessageFlags.SuppressNotifications,
        nonce: state.delivery_nonce, enforceNonce: true });
      messageId = sent.id;
    }
    await db.query(`UPDATE poke_post_thread_posts SET message_id=$3,content_hash=$4,attempted_at=NULL
      WHERE guild_id=$1 AND discord_user_id=$2`, [config.guildId,userId,messageId,fingerprint(profile)]);
  }
  async function tick() {
    if (running) return;
    running = true;
    let db, locked = false;
    try {
      db = await pool.connect();
      locked = (await db.query('SELECT pg_try_advisory_lock($1) AS locked',[LOCK])).rows[0].locked;
      if (!locked) return;
      const jobs = [];
      for (const config of configs) {
        // The adapter supplies only active profiles belonging to this server,
        // from BOTH primary feeds. Never infer cross-server activation.
        const profiles = await loadProfiles(db, config.guildId);
        const active = new Map(profiles.filter(p => p.public_message_id).map(p => [p.discord_user_id,p]));
        const states = (await db.query('SELECT * FROM poke_post_thread_posts WHERE guild_id=$1',[config.guildId])).rows;
        const previous = new Map(states.map(s => [s.discord_user_id,s]));
        for (const state of states) {
          const profile = active.get(state.discord_user_id);
          const target = profile ? config.threads[groupFor(profile.vivillon_pattern)] : null;
          if (!target || target !== state.thread_id || fingerprint(profile) !== state.content_hash) {
            jobs.push({config,profile:target?profile:null,state,priority:target?1:0});
          }
        }
        for (const profile of active.values()) {
          if (!previous.has(profile.discord_user_id) && config.threads[groupFor(profile.vivillon_pattern)]) {
            jobs.push({config,profile,priority:2});
          }
        }
      }
      jobs.sort((a,b) => a.priority-b.priority ||
        new Date(a.state?.checked_at || 0)-new Date(b.state?.checked_at || 0));
      // Blocked destinations back off so other profiles can progress. At most one
      // synchronization attempt (and one new thread message) per minute.
      for (const job of jobs) {
        const key = `${job.config.guildId}:${job.profile?.discord_user_id || job.state.discord_user_id}`;
        if ((blockedUntil.get(key) || 0) > now().getTime()) continue;
        const userId = job.profile?.discord_user_id || job.state.discord_user_id;
        try { await sync(db,job); return; }
        catch (error) {
          blockedUntil.set(key, now().getTime() + 300000);
          logger.error(JSON.stringify({event:'poke_post_thread_sync_failed',guildId:job.config.guildId,
            userId,errorCode:error.code || null,reason:error.message?.slice(0,180)}));
        } finally {
          await db.query('UPDATE poke_post_thread_posts SET checked_at=$3 WHERE guild_id=$1 AND discord_user_id=$2',
            [job.config.guildId,userId,now()]);
        }
        return; // Even an ambiguous send consumes this minute's delivery slot.
      }
    } finally {
      if (locked) {
        try { await db.query('SELECT pg_advisory_unlock($1)',[LOCK]); }
        catch { db.release(true); db = null; }
      }
      db?.release();
      running = false;
    }
  }
  return { initialize, tick };
}
module.exports = { createThreadRouter, validateConfig, fingerprint };
