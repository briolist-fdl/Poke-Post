const { MessageFlags, PermissionFlagsBits, ChannelType } = require('discord.js');

function createRegionModerator({ pool, client, configuredGuildId, patterns, getPublicChannelId,
  buildPublicMessage, buildButtons, logger = console }) {
  function audit(event) {
    logger.log(JSON.stringify({ event: 'poke_post_moderation', action: 'region',
      timestamp: new Date().toISOString(), ...event }));
  }

  return async function handleRegionModeration(interaction) {
    const privateReply = content => interaction.reply({ content, flags: MessageFlags.Ephemeral });
    if (!interaction.guildId || !configuredGuildId || interaction.guildId !== configuredGuildId) {
      return privateReply('Profile moderation is only available in the configured home server.');
    }
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      return privateReply('You need Manage Messages to correct another user’s profile.');
    }
    if (interaction.options.getSubcommand() !== 'region') return;
    const user = interaction.options.getUser('user', true);
    const pattern = interaction.options.getString('vivillon_pattern', true);
    if (!patterns.has(pattern)) return privateReply('Invalid Vivillon pattern.');
    const targetId = getPublicChannelId(pattern);
    if (!targetId) return privateReply('The destination friend-code channel is not configured.');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const event = { guildId: interaction.guildId, moderatorId: interaction.user.id,
      userId: user.id, newRegion: pattern, interactionId: interaction.id };
    let db, profile, oldMessage, oldPayload, newMessage, edited = false, committed = false, committing = false;
    let content = '';
    try {
      db = await pool.connect();
      await db.query('BEGIN');
      const result = await db.query('SELECT * FROM friendcode_profiles WHERE discord_user_id = $1 FOR UPDATE', [user.id]);
      profile = result.rows[0];
      if (!profile) {
        await db.query('ROLLBACK');
        return interaction.editReply({ content: 'That user has no saved profile.' });
      }
      Object.assign(event, { oldRegion: profile.vivillon_pattern, oldChannelId: profile.public_channel_id,
        oldMessageId: profile.public_message_id, newChannelId: targetId });
      const source = await interaction.guild.channels.fetch(profile.public_channel_id);
      const target = targetId === source?.id ? source : await interaction.guild.channels.fetch(targetId);
      for (const channel of [source, target]) {
        if (!channel || channel.guildId !== interaction.guildId ||
          ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
          throw new Error('Profile channels must be text or announcement channels in this server.');
        }
      }
      const me = interaction.guild.members.me || await interaction.guild.members.fetchMe();
      if (!source.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]) ||
          !target.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
        throw new Error('The bot is missing permissions to read the source or write to the destination.');
      }
      if (profile.public_message_id) {
        try { oldMessage = await source.messages.fetch(profile.public_message_id); }
        catch (error) { if (error.code !== 10008) throw error; }
        if (oldMessage && oldMessage.author.id !== client.user.id) {
          throw new Error('The stored post was not authored by this bot.');
        }
      }
      const updated = { ...profile, vivillon_pattern: pattern, public_channel_id: targetId };
      const payload = { content: await buildPublicMessage(updated), components: buildButtons(updated), allowedMentions: { parse: [] } };
      if (source.id === target.id && oldMessage) {
        oldPayload = { content: oldMessage.content, components: oldMessage.components, allowedMentions: { parse: [] } };
        await oldMessage.edit(payload);
        edited = true;
      } else {
        newMessage = await target.send(payload);
      }
      const messageId = newMessage?.id || oldMessage.id;
      await db.query(`UPDATE friendcode_profiles SET vivillon_pattern = $2, public_channel_id = $3,
        public_message_id = $4, updated_at = NOW() WHERE discord_user_id = $1`,
      [user.id, pattern, targetId, messageId]);
      committing = true;
      await db.query('COMMIT');
      committed = true;
      Object.assign(event, { newMessageId: messageId, outcome: 'saved' });
      content = `Updated ${user.id} to ${pattern.replace(/_/g, ' ')}. Post: <#${targetId}>.`;
      if (newMessage && oldMessage) {
        try { await oldMessage.delete(); }
        catch (error) {
          if (error.code !== 10008) {
            event.outcome = 'saved_cleanup_required';
            content += ` The old post could not be removed; remove it manually: https://discord.com/channels/${interaction.guildId}/${source.id}/${oldMessage.id}`;
          }
        }
      }
      audit(event);
    } catch (error) {
      if (db && !committed) await db.query('ROLLBACK').catch(() => {});
      let cleanupFailed = false;
      // A failed COMMIT response can mean the commit succeeded. Preserve posts for review.
      if (!committing && !committed) {
        if (newMessage) await newMessage.delete().catch(() => { cleanupFailed = true; });
        if (edited && oldMessage) {
          await oldMessage.edit(oldPayload).catch(() => { cleanupFailed = true; });
        }
      }
      audit({ ...event, outcome: committing ? 'commit_confirmation_failed' : 'failed',
        cleanupFailed, candidateMessageId: newMessage?.id || null, errorCode: error.code || null });
      content = committing
        ? 'The database confirmation failed. Check the profile and posts before retrying; the change may have been saved.'
        : 'The correction failed. The database change was not committed.';
      if (cleanupFailed) content += ' A public post also needs manual review; see the moderation log.';
    } finally {
      db?.release();
    }
    // Reply failures must never undo a successfully committed moderation action.
    return interaction.editReply({ content, allowedMentions: { parse: [] } });
  };
}

module.exports = { createRegionModerator };
