/**
 * Fixed, versioned synonym files per locale (contract spec, "Scoring"): POI
 * category and contact relationship synonyms. Shipped with the tool version,
 * never with a pack. Values are canonical category / relationship ids; keys
 * are raw phrases (normalized at index time).
 *
 * Bump a locale's `version` on ANY edit — it is written into the session
 * header as `synonyms_version` (e.g. "es-CO@1").
 */

export const SYNONYMS = {
  'es-CO': {
    version: 1,
    categories: {
      fuel: ['gasolinera', 'bomba', 'bomba de gasolina', 'estacion de servicio', 'estacion de gasolina', 'gasolina', 'tanquear', 'combustible'],
      ev_charging: ['cargador', 'electrolinera', 'estacion de carga', 'punto de carga', 'cargar el carro'],
      parking: ['parqueadero', 'estacionamiento', 'parqueo', 'donde parquear'],
      restaurant: ['restaurante', 'comida', 'almorzar', 'comer', 'corrientazo'],
      cafe: ['cafe', 'cafeteria', 'tinto', 'tomar un tinto', 'panaderia'],
      supermarket: ['supermercado', 'mercado', 'tienda', 'minimercado'],
      pharmacy: ['farmacia', 'drogueria', 'drogas'],
      hospital: ['hospital', 'clinica', 'urgencias'],
      hotel: ['hotel', 'hostal', 'alojamiento'],
      atm: ['cajero', 'cajero automatico', 'sacar plata'],
      car_service: ['taller', 'mecanico', 'montallantas', 'lavadero', 'lavautos'],
      landmark: ['monumento', 'parque', 'plaza', 'mirador'],
      home: ['casa', 'mi casa', 'la casa'],
      work: ['trabajo', 'oficina', 'la oficina'],
    },
    relationships: {
      brother: ['hermano'], sister: ['hermana'],
      mother: ['mama', 'madre', 'mami', 'cucha'], father: ['papa', 'padre', 'papi', 'cucho'],
      wife: ['esposa', 'senora', 'mujer'], husband: ['esposo', 'marido'],
      girlfriend: ['novia'], boyfriend: ['novio'], partner: ['pareja'],
      son: ['hijo'], daughter: ['hija'],
      grandmother: ['abuela', 'abuelita'], grandfather: ['abuelo', 'abuelito'],
      uncle: ['tio'], aunt: ['tia'], cousin: ['primo', 'prima'],
      friend: ['amigo', 'amiga', 'parcero', 'parcera', 'parce'],
      colleague: ['colega', 'companero de trabajo', 'companera de trabajo'],
      boss: ['jefe', 'jefa'], doctor: ['medico', 'medica', 'doctor', 'doctora'],
    },
  },
  'en-US': {
    version: 1,
    categories: {
      fuel: ['gas station', 'petrol station', 'gas', 'fuel', 'filling station'],
      ev_charging: ['charging station', 'charger', 'ev charger', 'charging point'],
      parking: ['parking', 'parking lot', 'car park', 'parking garage'],
      restaurant: ['restaurant', 'food', 'somewhere to eat', 'lunch', 'dinner'],
      cafe: ['cafe', 'coffee', 'coffee shop'],
      supermarket: ['supermarket', 'grocery', 'grocery store'],
      pharmacy: ['pharmacy', 'drugstore', 'chemist'],
      hospital: ['hospital', 'emergency room', 'clinic'],
      hotel: ['hotel', 'motel', 'lodging'],
      atm: ['atm', 'cash machine', 'cash point'],
      car_service: ['car service', 'mechanic', 'garage', 'car wash', 'tire shop'],
      landmark: ['landmark', 'monument', 'park', 'square'],
      home: ['home', 'my house'],
      work: ['work', 'office', 'the office'],
    },
    relationships: {
      brother: ['brother'], sister: ['sister'],
      mother: ['mother', 'mom', 'mum', 'mommy'], father: ['father', 'dad', 'daddy'],
      wife: ['wife'], husband: ['husband'], girlfriend: ['girlfriend'], boyfriend: ['boyfriend'], partner: ['partner'],
      son: ['son'], daughter: ['daughter'],
      grandmother: ['grandmother', 'grandma'], grandfather: ['grandfather', 'grandpa'],
      uncle: ['uncle'], aunt: ['aunt'], cousin: ['cousin'],
      friend: ['friend', 'buddy'], colleague: ['colleague', 'coworker'], boss: ['boss', 'manager'], doctor: ['doctor'],
    },
  },
  'de-DE': {
    version: 1,
    categories: {
      fuel: ['tankstelle', 'tanken'],
      ev_charging: ['ladestation', 'ladesaeule', 'laden'],
      parking: ['parkplatz', 'parkhaus', 'parken'],
      restaurant: ['restaurant', 'essen', 'gaststaette'],
      cafe: ['cafe', 'kaffee', 'baeckerei'],
      supermarket: ['supermarkt', 'einkaufen', 'lebensmittel'],
      pharmacy: ['apotheke'],
      hospital: ['krankenhaus', 'klinik', 'notaufnahme'],
      hotel: ['hotel', 'pension', 'unterkunft'],
      atm: ['geldautomat', 'bankautomat'],
      car_service: ['werkstatt', 'autowerkstatt', 'waschanlage'],
      landmark: ['sehenswuerdigkeit', 'denkmal', 'park', 'platz'],
      home: ['nach hause', 'zuhause', 'heim'],
      work: ['arbeit', 'buero', 'zur arbeit'],
    },
    relationships: {
      brother: ['bruder'], sister: ['schwester'], mother: ['mutter', 'mama'], father: ['vater', 'papa'],
      wife: ['frau', 'ehefrau'], husband: ['mann', 'ehemann'], girlfriend: ['freundin'], boyfriend: ['freund'],
      partner: ['partner', 'partnerin'], son: ['sohn'], daughter: ['tochter'],
      grandmother: ['oma', 'grossmutter'], grandfather: ['opa', 'grossvater'],
      uncle: ['onkel'], aunt: ['tante'], cousin: ['cousin', 'cousine'],
      friend: ['kumpel'], colleague: ['kollege', 'kollegin'], boss: ['chef', 'chefin'], doctor: ['arzt', 'aerztin'],
    },
  },
};

// Language-only fallbacks so "es-ES" or "en-GB" still pick a synonym file.
const LANG_FALLBACK = { es: 'es-CO', en: 'en-US', de: 'de-DE' };

export function synonymLocale(locale) {
  if (SYNONYMS[locale]) return locale;
  const lang = String(locale || '').split('-')[0];
  return LANG_FALLBACK[lang] || null;
}

/** "es-CO@1" style version string for the locales a pack matches over. */
export function synonymsVersion(locales) {
  const seen = [];
  for (const l of locales || []) {
    const s = synonymLocale(l);
    if (s && seen.indexOf(s) === -1) seen.push(s);
  }
  return seen.map((s) => s + '@' + SYNONYMS[s].version).join(',');
}
