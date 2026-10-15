/** Small, versioned manufacturer supplement. Never extrapolate a new generation. */
export const MANUFACTURER_SPECS = [
  { make: /^(hyundai|יונדאי)/i, model: /^i\s?20(?:\b|\s)/i, from: 2012, to: 2013, tank: 45,
    url: 'https://news.cision.com/hyundai-motor-company/r/hyundai-motor-unveils-all-new-i20-at-the-geneva-motor-show,c9228003' },
  { make: /^(kia|קיה|קיא)/i, model: /^(picanto|פיקנטו)(?:\b|\s|$)/i, from: 2017, to: 2019, tank: 35,
    url: 'https://www.kia.com/content/dam/kwcms/kme/uk/en/assets/vehicles/All-New%20Picanto/Specifications/picanto_2017-specification.pdf' },
  { make: /^(hyundai|יונדאי)/i, model: /^i\s?20(?:\b|\s)/i, from: 2018, to: 2018, tank: 50,
    url: 'https://www.hyundai.news/newsroom/dam/eu/press-kits/2018_i20/hyundai_i20_technical_specifications.pdf' },
  { make: /^(hyundai|יונדאי)/i, model: /^i\s?20\s+play(?:\b|\s)/i, from: 2019, to: 2019, tank: 50,
    url: 'https://www.hyundai.news/newsroom/dam/eu/uk/20190729_model_i20_play/i20_PLAY_Release_technical.pdf' },
];
export function manufacturerTank(make?: string, model?: string, year?: number | null, fuelType = '95') {
  if (!make || !model || !year || !['95', '98', 'diesel'].includes(fuelType)) return null;
  const entry = MANUFACTURER_SPECS.find(s => s.make.test(make.trim()) && s.model.test(model.trim()) && year >= s.from && year <= s.to);
  return entry ? { liters: entry.tank, url: entry.url } : null;
}
