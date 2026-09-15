const CAMPAIGN = 'vivillon-emojis-2026-09-15';
const LOCK = 7260515;
const MINUTE = 60000;
const POLICIES = {
  international: { transitionHours: 1, normalHours: 4, offsetMinutes: 0 },
  tundra: { transitionHours: 3, normalHours: 8, offsetMinutes: 30 }
};
function nextSlot(now, hours, offsetMinutes) {
  const span = hours * 60 * MINUTE, offset = offsetMinutes * MINUTE;
  return new Date((Math.floor((now.getTime() - offset) / span) + 1) * span + offset);
}
function createBumpScheduler({ pool, feeds, bump, now = () => new Date(), logger = console }) {
  let running = false;
  for (const feed of feeds) {
    if (!POLICIES[feed.name] || !feed.channelId || !Number.isFinite(feed.cooldownDays) || feed.cooldownDays < 0) {
      throw Error('Invalid bump feed configuration');
    }
  }
  if (new Set(feeds.map(f => f.channelId)).size !== feeds.length) throw Error('Bump channels must be distinct');
  async function transaction(work) {
    const db = await pool.connect();
    try { await db.query('BEGIN'); const result = await work(db); await db.query('COMMIT'); return result; }
    catch (error) { await db.query('ROLLBACK').catch(() => {}); throw error; }
    finally { db.release(); }
  }
  async function initialize() {
    await transaction(async db => {
      await db.query('SELECT pg_advisory_xact_lock($1)', [LOCK]);
      await db.query(`CREATE TABLE IF NOT EXISTS poke_post_bump_runs (
        campaign TEXT NOT NULL, channel_id TEXT NOT NULL, transition_complete BOOLEAN NOT NULL DEFAULT FALSE,
        next_run_at TIMESTAMPTZ NOT NULL, last_sent_at TIMESTAMPTZ,
        PRIMARY KEY(campaign, channel_id))`);
      await db.query(`CREATE TABLE IF NOT EXISTS poke_post_bump_queue (
        campaign TEXT NOT NULL, channel_id TEXT NOT NULL, discord_user_id TEXT NOT NULL,
        source_message_id TEXT NOT NULL, PRIMARY KEY(campaign, channel_id, discord_user_id))`);
      for (const feed of feeds) {
        const policy = POLICIES[feed.name];
        const inserted = await db.query(`INSERT INTO poke_post_bump_runs(campaign,channel_id,next_run_at)
          VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING channel_id`,
        [CAMPAIGN, feed.channelId, nextSlot(now(), policy.transitionHours, policy.offsetMinutes)]);
        if (inserted.rows.length) {
          await db.query(`INSERT INTO poke_post_bump_queue(campaign,channel_id,discord_user_id,source_message_id)
            SELECT $1,public_channel_id,discord_user_id,public_message_id FROM friendcode_profiles
            WHERE public_channel_id=$2 AND public_message_id IS NOT NULL ON CONFLICT DO NOTHING`, [CAMPAIGN, feed.channelId]);
        }
        const state = (await db.query('SELECT * FROM poke_post_bump_runs WHERE campaign=$1 AND channel_id=$2', [CAMPAIGN,feed.channelId])).rows[0];
        // Never catch up a missed slot immediately after restart. Keep queue progress.
        await db.query('UPDATE poke_post_bump_runs SET next_run_at=$3 WHERE campaign=$1 AND channel_id=$2',
          [CAMPAIGN, feed.channelId, nextSlot(now(), state.transition_complete ? policy.normalHours : policy.transitionHours, policy.offsetMinutes)]);
      }
    });
  }
  async function tick() {
    if (running) return;
    running = true;
    try {
      return await transaction(async db => {
        const lock = await db.query('SELECT pg_try_advisory_xact_lock($1) AS locked', [LOCK]);
        if (!lock.rows[0].locked) return;
        const time = now();
        const states = (await db.query('SELECT * FROM poke_post_bump_runs WHERE campaign=$1 ORDER BY next_run_at,channel_id', [CAMPAIGN])).rows;
        // Keep at least 30 minutes between feeds, including a delayed previous send.
        if (states.some(s => s.last_sent_at && time - new Date(s.last_sent_at) < 30 * MINUTE)) return;
        for (const state of states) {
          const feed = feeds.find(f => f.channelId === state.channel_id);
          if (!feed || new Date(state.next_run_at) > time) continue;
          const policy = POLICIES[feed.name];
          let transition = !state.transition_complete;
          let candidate;
          const cutoff = new Date(time.getTime() - feed.cooldownDays * 86400000);
          if (transition) {
            // Replacement posts and removals after campaign start need no queued bump.
            await db.query(`DELETE FROM poke_post_bump_queue q WHERE q.campaign=$1 AND q.channel_id=$2
              AND NOT EXISTS(SELECT 1 FROM friendcode_profiles p WHERE p.discord_user_id=q.discord_user_id
              AND p.public_channel_id=q.channel_id AND p.public_message_id=q.source_message_id)`, [CAMPAIGN,feed.channelId]);
            const pending = (await db.query('SELECT 1 FROM poke_post_bump_queue WHERE campaign=$1 AND channel_id=$2 LIMIT 1', [CAMPAIGN,feed.channelId])).rows.length;
            if (!pending) transition = false;
            else candidate = (await db.query(`SELECT p.* FROM friendcode_profiles p JOIN poke_post_bump_queue q
              ON q.discord_user_id=p.discord_user_id AND q.channel_id=p.public_channel_id
              WHERE q.campaign=$1 AND q.channel_id=$2 AND (p.last_bumped_at IS NULL OR p.last_bumped_at < $3)
              ORDER BY p.last_bumped_at NULLS FIRST,p.created_at,p.discord_user_id LIMIT 1`, [CAMPAIGN,feed.channelId,cutoff])).rows[0];
          }
          if (!transition && state.transition_complete) {
            candidate = (await db.query(`SELECT * FROM friendcode_profiles WHERE public_channel_id=$1
              AND public_message_id IS NOT NULL AND (last_bumped_at IS NULL OR last_bumped_at < $2)
              ORDER BY RANDOM() LIMIT 1`, [feed.channelId,cutoff])).rows[0];
          }
          // Do not publish a normal-cycle post immediately when transition ends.
          let sent = false;
          if (candidate) sent = await bump(candidate) === true;
          if (sent && transition) {
            await db.query('DELETE FROM poke_post_bump_queue WHERE campaign=$1 AND channel_id=$2 AND discord_user_id=$3', [CAMPAIGN,feed.channelId,candidate.discord_user_id]);
            transition = (await db.query('SELECT 1 FROM poke_post_bump_queue WHERE campaign=$1 AND channel_id=$2 LIMIT 1',[CAMPAIGN,feed.channelId])).rows.length > 0;
          }
          await db.query(`UPDATE poke_post_bump_runs SET transition_complete=$3,next_run_at=$4,
            last_sent_at=CASE WHEN $5 THEN $6 ELSE last_sent_at END WHERE campaign=$1 AND channel_id=$2`,
          [CAMPAIGN,feed.channelId,!transition,nextSlot(time,transition ? policy.transitionHours : policy.normalHours,policy.offsetMinutes),sent,now()]);
          if (sent) {
            logger.log(JSON.stringify({event:'poke_post_bump_schedule',channelId:feed.channelId,phase:transition?'transition':'normal',messageCount:1}));
            return;
          }
        }
      });
    } finally { running = false; }
  }
  return { initialize, tick };
}
module.exports = { createBumpScheduler, nextSlot, POLICIES, CAMPAIGN };
