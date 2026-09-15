const { ModalBuilder, LabelBuilder, TextInputBuilder, TextInputStyle,
  StringSelectMenuBuilder, MessageFlags } = require('discord.js');

function createProfileForm({ configuredGuildId, patterns, getProfile, normalizeCode, saveAndPublish }) {
  const titles = value => value.split('_').map(word => word[0].toUpperCase() + word.slice(1)).join(' ');
  function build(profile) {
    function text(id, label, value, required, maxLength) {
      const input = new TextInputBuilder().setCustomId(id).setStyle(TextInputStyle.Short)
        .setRequired(required).setMaxLength(maxLength);
      if (value) input.setValue(value);
      return new LabelBuilder().setLabel(label).setTextInputComponent(input);
    }
    const region = new StringSelectMenuBuilder().setCustomId('vivillon_pattern')
      .setPlaceholder('Choose your own Vivillon region').setMinValues(1).setMaxValues(1)
      .addOptions([...patterns].map(value => ({ label: titles(value), value, default: value === profile?.vivillon_pattern })));
    const publishing = new StringSelectMenuBuilder().setCustomId('publish_to_followers')
      .setPlaceholder('Choose whether follower servers may receive your post').setMinValues(1).setMaxValues(1)
      .addOptions([
        { label: 'Yes — allow republishing', value: 'yes', default: profile?.publish_to_followers === true },
        { label: 'No — keep it in this server', value: 'no', default: profile?.publish_to_followers === false }
      ]);
    return new ModalBuilder().setCustomId(profile ? 'profile_form:edit' : 'profile_form:setup')
      .setTitle(profile ? 'Edit your friend code profile' : 'Create your friend code profile')
      .addLabelComponents(
        text('pokemon_username', 'Pokémon GO username', profile?.pokemon_username, true, 64),
        text('trainer_code', 'Trainer code (12 digits)', profile?.trainer_code_formatted, true, 32),
        new LabelBuilder().setLabel('Your Vivillon region').setStringSelectMenuComponent(region),
        text('campfire_username', 'Campfire username (optional)', profile?.campfire_username, false, 64),
        new LabelBuilder().setLabel('Republish to follower servers?').setStringSelectMenuComponent(publishing)
      );
  }
  async function guard(interaction) {
    if (!interaction.guildId || !configuredGuildId || interaction.guildId !== configuredGuildId) {
      await interaction.reply({ content: 'Profile setup and editing are only available in the configured home server.', flags: MessageFlags.Ephemeral });
      return false;
    }
    return true;
  }
  async function open(interaction, mode) {
    if (!await guard(interaction)) return;
    const profile = await getProfile(interaction.user.id);
    if (mode === 'edit' && !profile) {
      return interaction.reply({ content: 'You do not have a saved profile yet. Use `/post setup` first.', flags: MessageFlags.Ephemeral });
    }
    return interaction.showModal(build(profile));
  }
  async function submit(interaction) {
    if (!await guard(interaction)) return;
    if (!['profile_form:setup', 'profile_form:edit'].includes(interaction.customId)) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const current = await getProfile(interaction.user.id);
    if (interaction.customId === 'profile_form:edit' && !current) {
      return interaction.editReply({ content: 'Your profile was deleted while this form was open. Use `/post setup` to create it again.' });
    }
    if (interaction.customId === 'profile_form:setup' && current) {
      return interaction.editReply({ content: 'You already created a profile while this form was open. Use `/post edit` to review it.' });
    }
    const name = interaction.fields.getTextInputValue('pokemon_username').trim();
    const code = normalizeCode(interaction.fields.getTextInputValue('trainer_code'));
    const campfire = interaction.fields.getTextInputValue('campfire_username').trim();
    const regions = interaction.fields.getStringSelectValues('vivillon_pattern');
    const choices = interaction.fields.getStringSelectValues('publish_to_followers');
    if (!name || name.length > 64 || campfire.length > 64 || !code || regions.length !== 1 ||
        !patterns.has(regions[0]) || choices.length !== 1 || !['yes','no'].includes(choices[0])) {
      return interaction.editReply({ content: 'Check your name, 12-digit trainer code, region and republishing choice, then reopen the form.' });
    }
    const content = await saveAndPublish({ user: interaction.user, guild: interaction.guild, current,
      pokemonUsername: name, trainerCodeRaw: code, campfireUsername: campfire || null,
      vivillonPattern: regions[0], publishToFollowers: choices[0] === 'yes' });
    return interaction.editReply({ content, allowedMentions: { parse: [] } });
  }
  return { open, submit, build };
}
module.exports = { createProfileForm };
