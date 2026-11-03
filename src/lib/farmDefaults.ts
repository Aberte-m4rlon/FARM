// ─── Farm Defaults: Presets for all dropdown/autocomplete fields ──────────────
// Covers goat & sheep breeds, vaccines, inventory items,
// units, suppliers, veterinarians, and color markings.

// ── Animal Breeds ─────────────────────────────────────────────────────────────

export const GOAT_BREEDS = [
  'Anglo-Nubian', 'Boer', 'Kiko', 'La Mancha', 'Nubian', 'Oberhasli',
  'Saanen', 'Toggenburg', 'Alpine', 'Nigerian Dwarf', 'Pygmy',
  'Angora', 'Cashmere', 'Fainting Goat', 'Spanish', 'Kalahari Red',
  'Savanna', 'Sirohi', 'Beetal', 'Barbari', 'Jamnapari',
  'Black Bengal', 'Osmanabadi', 'Malabari', 'Sannen',
  'Philippine Native Goat', 'Batangas Goat',
];

export const SHEEP_BREEDS = [
  'Merino', 'Suffolk', 'Dorper', 'Hampshire', 'Rambouillet',
  'Corriedale', 'Romney', 'Texel', 'Katahdin', 'Barbados Blackbelly',
  'Dorset', 'Lincoln', 'Border Leicester', 'Jacob', 'Karakul',
  'East Friesian', 'Finn', 'Icelandic', 'Cheviot', 'Columbia',
  'Perendale', 'Southdown', 'Shropshire', 'Oxford',
  'Philippine Native Sheep',
];

export function getBreedsForSpecies(species: string): string[] {
  if (species === 'Goat') return GOAT_BREEDS;
  if (species === 'Sheep') return SHEEP_BREEDS;
  return [...GOAT_BREEDS, ...SHEEP_BREEDS];
}

// ── Vaccines ──────────────────────────────────────────────────────────────────

export const GOAT_SHEEP_VACCINES = [
  // Core vaccines
  'PPR Vaccine (Peste des Petits Ruminants)',
  'FMD Vaccine (Foot and Mouth Disease)',
  'Clostridial / CD&T Vaccine',
  'Brucellosis Vaccine (Rev-1)',
  'Enterotoxemia Vaccine',
  'Tetanus Toxoid',
  'Caseous Lymphadenitis (CLA) Vaccine',
  'Rabies Vaccine',
  'Ovine Johne\'s Disease Vaccine',
  'Contagious Ecthyma (Orf) Vaccine',
  'Bluetongue Vaccine',
  'Caprine Arthritis-Encephalitis (CAE) Vaccine',
  // Philippines-common
  'Hemorrhagic Septicemia (HS) Vaccine',
  'Anthrax Spore Vaccine',
  'Black Quarter (BQ) Vaccine',
];

// ── Units ─────────────────────────────────────────────────────────────────────

export const INVENTORY_UNITS = [
  'kg', 'g', 'mg', 'L', 'mL', 'pcs', 'vials', 'bottles', 'boxes',
  'sacks', 'bags', 'rolls', 'pairs', 'sets', 'doses', 'tablets',
  'capsules', 'ampoules', 'strips',
];

// ── Color / Markings ──────────────────────────────────────────────────────────

export const COLOR_MARKINGS = [
  'All White', 'All Black', 'All Brown', 'All Gray', 'All Tan',
  'Black and White', 'Brown and White', 'Black and Brown',
  'White with Black spots', 'White with Brown spots',
  'Brown with White spots', 'Black with White face',
  'Tan with Black stripe', 'Gray with White patches',
  'Reddish Brown', 'Golden / Yellow', 'Cream',
  'Spotted (Multi-color)', 'Piebald', 'Roan',
];

// ── Veterinarian names (user can add their own too) ──────────────────────────

export const COMMON_VETS = [
  'Dr. Santos', 'Dr. Reyes', 'Dr. Cruz', 'Dr. Garcia', 'Dr. Lim',
  'Dr. Mendoza', 'Dr. Torres', 'Dr. Flores', 'Dr. Rivera', 'Dr. Aquino',
  'Municipal Agriculturist', 'Provincial Vet Office',
  'DA-BAI (Bureau of Animal Industry)', 'Private Veterinarian',
];
