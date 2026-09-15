const { MessageFlags, PermissionFlagsBits, ChannelType } = require('discord.js');

function createPostRemover({ pool, client, configuredGuildId, logger = console }) {
  return async function removePost(interaction) {
    const reply = content => interaction.reply({ content, flags: MessageFlags.Ephemeral });
    if (!interaction.guildId || !configuredGuildId || interaction.guildId !== configuredGuildId) {
      return reply('Profile moderation is only available in the configured home server.');
    }
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      return reply('You need Manage Messages to remove another user’s post.');
    }
    const input = interaction.options.getString('user', true).trim();
    const match = /^(?:<@!?(\d{17,20})>|(\d{17,20}))$/.exec(input);
    const userId = match?.[1] || match?.[2];
    if (!userId) return reply('Enter the profile owner’s user ID or @mention.');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const event = { event: 'poke_post_moderation', action: 'remove',
      timestamp: new Date().toISOString(), guildId: interaction.guildId,
      moderatorId: interaction.user.id, userId, interactionId: interaction.id };
    let db, deleted = false, committing = false;
    let content;
    try {
      db = await pool.connect();
      await db.query('BEGIN');
      const { rows } = await db.query('SELECT * FROM friendcode_profiles WHERE discord_user_id = $1 FOR UPDATE', [userId]);
      const profile = rows[0];
      if (!profile || !profile.public_message_id) {
        await db.query('ROLLBACK');
        return interaction.editReply({ content: profile ? 'That profile has no active public post.' : 'That user has no saved profile.' });
      }
      Object.assign(event, { oldChannelId: profile.public_channel_id, oldMessageId: profile.public_message_id });
      const channel = await interaction.guild.channels.fetch(profile.public_channel_id);
      if (!channel || channel.guildId !== interaction.guildId ||
          ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
        throw Error('Invalid profile channel');
      }
      const me = interaction.guild.members.me || await interaction.guild.members.fetchMe();
      if (!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory])) {
        throw Error('Missing channel access');
      }
      let message;
      try { message = await channel.messages.fetch(profile.public_message_id); }
      catch (error) { if (error.code !== 10008) throw error; }
      if (message) {
        if (message.author.id !== client.user.id) throw Error('Post is not authored by this bot');
        try { await message.delete(); }
        catch (error) { if (error.code !== 10008) throw error; }
      }
      deleted = true;
      await db.query('UPDATE friendcode_profiles SET public_message_id = NULL, updated_at = NOW() WHERE discord_user_id = $1', [userId]);
      committing = true;
      await db.query('COMMIT');
      event.outcome = 'removed';
      content = 'Public post removed and automatic bumping stopped. The saved profile remains. The owner can still publish it again; this is not a posting ban.';
    } catch (error) {
      if (db) await db.query('ROLLBACK').catch(() => {});
      event.outcome = committing ? 'commit_confirmation_failed' : deleted ? 'post_removed_database_failed' : 'failed';
      event.errorCode = error.code || null;
      content = deleted
        ? 'The public post is gone, but the database confirmation failed. Automatic bumping may still be enabled. Retry this removal and check the moderation log.'
        : 'Removal failed. Check the bot’s channel access and the stored post; the saved profile was not changed.';
    } finally {
      db?.release();
    }
    logger.log(JSON.stringify(event));
    return interaction.editReply({ content, allowedMentions: { parse: [] } });
  };
}

module.exports = { createPostRemover };
