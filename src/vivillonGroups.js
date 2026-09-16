const GROUPS = Object.freeze({
  blizzard: ['icy_snow', 'polar', 'tundra'],
  waves: ['archipelago', 'marine', 'ocean'],
  horizons: ['high_plains', 'sandstorm', 'sun'],
  wetlands: ['jungle', 'monsoon', 'river'],
  bloom: ['savanna', 'meadow', 'garden'],
  crossroads: ['continental', 'elegant', 'modern']
});
function groupFor(pattern) {
  const group = Object.keys(GROUPS).find(key => GROUPS[key].includes(pattern));
  if (!group) throw Error('Invalid Vivillon pattern');
  return group;
}
module.exports = { GROUPS, groupFor };
