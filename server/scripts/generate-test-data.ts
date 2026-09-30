/**
 * Генератор ручной тестовой базы поставщиков (MANUAL_TEST_DATA).
 * Все компании вымышленные. ИНН и ОГРН начинаются с кода региона «00», которого не существует,
 * поэтому совпадение с реальными организациями исключено. Контрольные цифры корректны.
 *
 * Запуск: npm run gen:data  → перезаписывает data/suppliers.json
 */
import fs from 'node:fs';
import path from 'node:path';

type Role = 'MANUFACTURER' | 'DISTRIBUTOR' | 'SUPPLIER' | 'UNKNOWN';
type Sme = 'MICRO' | 'SMALL' | 'MEDIUM' | null;
type DocKind = 'decl' | 'cert' | 'fire' | 'decl_expired' | 'cert_suspended' | 'decl_other_product';
type Risk = 'rnp' | 'bankruptcy_intent' | 'unreliable_address';

interface Spec {
  name: string;
  cat: string;
  products: string[];
  role: Role;
  region: string;
  city: string;
  sme: Sme;
  gisp?: boolean;
  pp719?: boolean;
  docs?: DocKind[];
  docFrom?: string; // для дистрибьютора: чьи документы (имя производителя из базы)
  status?: 'ACTIVE' | 'INACTIVE';
  risks?: Risk[];
  website?: boolean;
  fin?: boolean;
  stale?: boolean;
  young?: boolean;
  conflict?: boolean;
  ip?: boolean;
  brand?: string;
}

const SPECS: Spec[] = [
  // ── Лакокрасочные материалы ──────────────────────────────────────────────
  { name: 'ООО «Ногинский завод лакокрасочных материалов»', cat: 'paints', products: ['paint_construction', 'paint_facade', 'paint_interior', 'primer'], role: 'MANUFACTURER', region: '50', city: 'Ногинск', sme: 'SMALL', gisp: true, pp719: true, docs: ['decl', 'cert'], website: true, fin: true, brand: 'НЗЛКМ' },
  { name: 'АО «Колорит-Подольск»', cat: 'paints', products: ['paint_construction', 'paint_facade', 'enamel'], role: 'MANUFACTURER', region: '50', city: 'Подольск', sme: 'MEDIUM', gisp: true, pp719: true, docs: ['decl'], website: true, fin: true, brand: 'Колорит' },
  { name: 'ООО «Краски Мытищ»', cat: 'paints', products: ['paint_interior', 'paint_construction'], role: 'MANUFACTURER', region: '50', city: 'Мытищи', sme: 'SMALL', docs: ['decl'], brand: 'Мытищинские краски' },
  { name: 'ООО «Лаковый двор»', cat: 'paints', products: ['paint_construction', 'paint_facade', 'enamel', 'varnish'], role: 'DISTRIBUTOR', region: '77', city: 'Москва', sme: 'SMALL', docs: ['decl'], docFrom: 'ООО «Ногинский завод лакокрасочных материалов»', website: true },
  { name: 'ООО «СтройКолор Трейд»', cat: 'paints', products: ['paint_construction', 'primer'], role: 'SUPPLIER', region: '77', city: 'Москва', sme: 'MICRO' },
  { name: 'ООО «Химтех-Краска»', cat: 'paints', products: ['paint_facade', 'paint_construction', 'primer'], role: 'MANUFACTURER', region: '71', city: 'Новомосковск', sme: 'SMALL', gisp: true, pp719: true, docs: ['decl', 'cert'], website: true, brand: 'Химтех' },
  { name: 'ООО «Эмалит»', cat: 'paints', products: ['enamel', 'paint_construction'], role: 'MANUFACTURER', region: '50', city: 'Электросталь', sme: 'MICRO', docs: ['decl_expired'], young: true, risks: ['unreliable_address'], brand: 'Эмалит' },
  { name: 'ООО «Фасад-Профи»', cat: 'paints', products: ['paint_facade'], role: 'DISTRIBUTOR', region: '50', city: 'Химки', sme: 'SMALL', docs: ['decl'], docFrom: 'АО «Колорит-Подольск»', conflict: true, website: true },
  { name: 'АО «Калужские покрытия»', cat: 'paints', products: ['paint_construction', 'paint_interior', 'varnish'], role: 'MANUFACTURER', region: '40', city: 'Калуга', sme: 'MEDIUM', gisp: true, docs: ['decl'], fin: true, website: true, brand: 'КалугаКолор' },
  { name: 'ООО «Красочный ряд»', cat: 'paints', products: ['paint_construction'], role: 'MANUFACTURER', region: '50', city: 'Серпухов', sme: null, docs: ['decl'], status: 'INACTIVE' },
  { name: 'ООО «ТверьЛак»', cat: 'paints', products: ['varnish', 'enamel', 'paint_construction'], role: 'MANUFACTURER', region: '69', city: 'Тверь', sme: 'SMALL', gisp: true, docs: ['cert'], brand: 'ТверьЛак' },
  { name: 'ИП Горелов Андрей Викторович', cat: 'paints', products: ['paint_construction'], role: 'UNKNOWN', region: '50', city: 'Коломна', sme: 'MICRO', ip: true },
  { name: 'ООО «Мастер Краски Опт»', cat: 'paints', products: ['paint_construction', 'paint_interior'], role: 'DISTRIBUTOR', region: '50', city: 'Люберцы', sme: 'SMALL', docs: ['decl'], docFrom: 'ООО «Краски Мытищ»', risks: ['rnp'] },

  // ── Сухие строительные смеси ─────────────────────────────────────────────
  { name: 'ООО «Воскресенский завод строительных смесей»', cat: 'dry_mixes', products: ['plaster', 'putty', 'tile_adhesive', 'floor_mix'], role: 'MANUFACTURER', region: '50', city: 'Воскресенск', sme: 'MEDIUM', gisp: true, pp719: true, docs: ['decl'], website: true, fin: true, brand: 'ВЗСС' },
  { name: 'ООО «Смеси Подмосковья»', cat: 'dry_mixes', products: ['plaster', 'masonry_mix'], role: 'MANUFACTURER', region: '50', city: 'Дмитров', sme: 'SMALL', gisp: true, docs: ['decl'], brand: 'СмесьПро' },
  { name: 'ООО «ГипсМастер»', cat: 'dry_mixes', products: ['plaster', 'putty'], role: 'MANUFACTURER', region: '71', city: 'Тула', sme: 'SMALL', docs: ['decl', 'cert'], website: true, brand: 'ГипсМастер' },
  { name: 'ООО «СухСтрой Логистик»', cat: 'dry_mixes', products: ['plaster', 'putty', 'tile_adhesive', 'floor_mix', 'masonry_mix'], role: 'DISTRIBUTOR', region: '77', city: 'Москва', sme: 'SMALL', docs: ['decl'], docFrom: 'ООО «Воскресенский завод строительных смесей»', website: true },
  { name: 'ООО «Клеевые системы»', cat: 'dry_mixes', products: ['tile_adhesive'], role: 'MANUFACTURER', region: '50', city: 'Балашиха', sme: 'SMALL', gisp: true, docs: ['decl_other_product'], brand: 'КлейСис' },
  { name: 'ООО «Ровный пол»', cat: 'dry_mixes', products: ['floor_mix'], role: 'MANUFACTURER', region: '33', city: 'Владимир', sme: 'MICRO', docs: ['decl'], brand: 'РовПол' },
  { name: 'ООО «Базис-Смеси»', cat: 'dry_mixes', products: ['plaster', 'masonry_mix'], role: 'MANUFACTURER', region: '62', city: 'Рязань', sme: 'SMALL', gisp: true, docs: ['decl'], risks: ['bankruptcy_intent'], brand: 'Базис' },
  { name: 'ООО «Цементные решения»', cat: 'dry_mixes', products: ['masonry_mix', 'plaster'], role: 'SUPPLIER', region: '50', city: 'Королёв', sme: 'MICRO' },
  { name: 'АО «Ярославские строительные смеси»', cat: 'dry_mixes', products: ['putty', 'tile_adhesive', 'plaster'], role: 'MANUFACTURER', region: '76', city: 'Ярославль', sme: 'MEDIUM', gisp: true, pp719: true, docs: ['decl'], fin: true, stale: true, brand: 'ЯрСмесь' },
  { name: 'ООО «Шпаклёвка.Про»', cat: 'dry_mixes', products: ['putty'], role: 'UNKNOWN', region: '77', city: 'Москва', sme: 'MICRO' },
  { name: 'ООО «Стройсмесь-Юг»', cat: 'dry_mixes', products: ['plaster', 'tile_adhesive'], role: 'MANUFACTURER', region: '23', city: 'Краснодар', sme: 'MEDIUM', gisp: true, docs: ['decl'], brand: 'ЮгСмесь' },

  // ── Теплоизоляция ────────────────────────────────────────────────────────
  { name: 'ООО «Теплоизол-Раменское»', cat: 'insulation', products: ['mineral_wool'], role: 'MANUFACTURER', region: '50', city: 'Раменское', sme: 'MEDIUM', gisp: true, pp719: true, docs: ['decl', 'fire'], website: true, fin: true, brand: 'ТеплоРам' },
  { name: 'ООО «ПенопластСтрой»', cat: 'insulation', products: ['eps'], role: 'MANUFACTURER', region: '50', city: 'Егорьевск', sme: 'SMALL', gisp: true, docs: ['decl', 'fire'], brand: 'ПСБ-Строй' },
  { name: 'ООО «Экструзия Центр»', cat: 'insulation', products: ['xps'], role: 'MANUFACTURER', region: '40', city: 'Обнинск', sme: 'SMALL', gisp: true, pp719: true, docs: ['fire'], website: true, brand: 'ЭкструЦентр' },
  { name: 'ООО «Утеплим»', cat: 'insulation', products: ['mineral_wool', 'eps', 'xps'], role: 'DISTRIBUTOR', region: '77', city: 'Москва', sme: 'SMALL', docs: ['fire'], docFrom: 'ООО «Теплоизол-Раменское»', website: true },
  { name: 'ООО «ПИР-Технологии»', cat: 'insulation', products: ['pir'], role: 'MANUFACTURER', region: '71', city: 'Алексин', sme: 'SMALL', gisp: true, docs: ['cert_suspended'], brand: 'ПИРТех' },
  { name: 'ООО «Тёплый дом Опт»', cat: 'insulation', products: ['mineral_wool', 'eps'], role: 'SUPPLIER', region: '50', city: 'Одинцово', sme: 'MICRO' },
  { name: 'АО «Минплита»', cat: 'insulation', products: ['mineral_wool'], role: 'MANUFACTURER', region: '78', city: 'Санкт-Петербург', sme: 'MEDIUM', gisp: true, pp719: true, docs: ['decl', 'fire'], fin: true, brand: 'Минплита' },
  { name: 'ООО «Изоляция 69»', cat: 'insulation', products: ['eps'], role: 'MANUFACTURER', region: '69', city: 'Конаково', sme: 'MICRO', docs: ['decl'], young: true, brand: 'Изо69' },
  { name: 'ООО «ТермоБаза»', cat: 'insulation', products: ['xps', 'pir'], role: 'DISTRIBUTOR', region: '50', city: 'Щёлково', sme: 'SMALL', docs: ['fire'], docFrom: 'ООО «Экструзия Центр»', risks: ['rnp'] },
  { name: 'ООО «Северный утеплитель»', cat: 'insulation', products: ['mineral_wool'], role: 'MANUFACTURER', region: '76', city: 'Рыбинск', sme: null, docs: ['decl'], status: 'INACTIVE' },

  // ── Крепёж ───────────────────────────────────────────────────────────────
  { name: 'ООО «Метизный завод Подмосковья»', cat: 'fasteners', products: ['screws', 'anchors', 'bolts_nuts', 'dowels'], role: 'MANUFACTURER', region: '50', city: 'Орехово-Зуево', sme: 'MEDIUM', gisp: true, pp719: true, docs: ['cert'], website: true, fin: true, brand: 'МЗП' },
  { name: 'ООО «Крепёж-Сервис»', cat: 'fasteners', products: ['screws', 'anchors', 'dowels', 'bolts_nuts', 'wood_screws'], role: 'DISTRIBUTOR', region: '77', city: 'Москва', sme: 'SMALL', docs: ['cert'], docFrom: 'ООО «Метизный завод Подмосковья»', website: true },
  { name: 'ООО «Анкерные системы»', cat: 'fasteners', products: ['anchors', 'dowels'], role: 'MANUFACTURER', region: '50', city: 'Жуковский', sme: 'SMALL', gisp: true, docs: ['cert'], brand: 'АнкерСис' },
  { name: 'ООО «Тульский метиз»', cat: 'fasteners', products: ['bolts_nuts', 'screws'], role: 'MANUFACTURER', region: '71', city: 'Тула', sme: 'MEDIUM', gisp: true, pp719: true, docs: ['cert'], fin: true, website: true, brand: 'ТулМетиз' },
  { name: 'ООО «Саморез Опт»', cat: 'fasteners', products: ['screws', 'wood_screws'], role: 'SUPPLIER', region: '50', city: 'Красногорск', sme: 'MICRO' },
  { name: 'ООО «Дюбель-Про»', cat: 'fasteners', products: ['dowels'], role: 'MANUFACTURER', region: '33', city: 'Ковров', sme: 'SMALL', gisp: true, brand: 'ДюбельПро' },
  { name: 'ООО «ВинтТорг»', cat: 'fasteners', products: ['screws', 'bolts_nuts'], role: 'DISTRIBUTOR', region: '50', city: 'Пушкино', sme: 'SMALL', docs: ['cert'], docFrom: 'ООО «Тульский метиз»', risks: ['unreliable_address'] },
  { name: 'ООО «Нижегородские крепёжные изделия»', cat: 'fasteners', products: ['bolts_nuts', 'anchors'], role: 'MANUFACTURER', region: '52', city: 'Дзержинск', sme: 'MEDIUM', gisp: true, pp719: true, docs: ['cert'], brand: 'НКИ' },
  { name: 'ИП Сафонов Дмитрий Игоревич', cat: 'fasteners', products: ['wood_screws', 'screws'], role: 'UNKNOWN', region: '77', city: 'Москва', sme: 'MICRO', ip: true },
  { name: 'ООО «Метиз-Регион»', cat: 'fasteners', products: ['screws', 'dowels'], role: 'DISTRIBUTOR', region: '62', city: 'Рязань', sme: 'SMALL' },
  { name: 'ООО «Калужский крепёж»', cat: 'fasteners', products: ['screws', 'wood_screws'], role: 'MANUFACTURER', region: '40', city: 'Людиново', sme: 'SMALL', gisp: true, docs: ['cert'], stale: true, brand: 'КалугаКреп' },

  // ── Кровля и гидроизоляция ───────────────────────────────────────────────
  { name: 'ООО «Изобит-Кровля»', cat: 'roofing', products: ['roll_waterproofing', 'bitumen_mastic'], role: 'MANUFACTURER', region: '50', city: 'Шатура', sme: 'MEDIUM', gisp: true, pp719: true, docs: ['decl', 'fire'], website: true, fin: true, brand: 'Изобит' },
  { name: 'ООО «Мастики Центра»', cat: 'roofing', products: ['bitumen_mastic'], role: 'MANUFACTURER', region: '50', city: 'Клин', sme: 'SMALL', docs: ['decl'], brand: 'МастЦентр' },
  { name: 'ООО «ПолимерМембрана»', cat: 'roofing', products: ['pvc_membrane'], role: 'MANUFACTURER', region: '71', city: 'Ефремов', sme: 'SMALL', gisp: true, docs: ['fire'], brand: 'ПолиМем' },
  { name: 'ООО «КровляМаркет»', cat: 'roofing', products: ['roll_waterproofing', 'pvc_membrane', 'metal_tile', 'bitumen_mastic'], role: 'DISTRIBUTOR', region: '77', city: 'Москва', sme: 'SMALL', docs: ['decl'], docFrom: 'ООО «Изобит-Кровля»', website: true },
  { name: 'ООО «Металлочерепица-Сервис»', cat: 'roofing', products: ['metal_tile'], role: 'MANUFACTURER', region: '50', city: 'Чехов', sme: 'SMALL', gisp: true, pp719: true, docs: ['decl'], brand: 'МЧ-Сервис' },
  { name: 'ООО «ГидроСтоп»', cat: 'roofing', products: ['roll_waterproofing', 'bitumen_mastic'], role: 'SUPPLIER', region: '50', city: 'Видное', sme: 'MICRO' },
  { name: 'ООО «Рязанский кровельный комбинат»', cat: 'roofing', products: ['roll_waterproofing'], role: 'MANUFACTURER', region: '62', city: 'Рязань', sme: 'MEDIUM', gisp: true, docs: ['decl'], fin: true, brand: 'РКК' },
  { name: 'ООО «Крыша-Проф»', cat: 'roofing', products: ['metal_tile'], role: 'DISTRIBUTOR', region: '69', city: 'Тверь', sme: 'MICRO', risks: ['rnp'] },
  { name: 'ООО «Битумные технологии»', cat: 'roofing', products: ['bitumen_mastic', 'roll_waterproofing'], role: 'MANUFACTURER', region: '16', city: 'Казань', sme: 'MEDIUM', gisp: true, pp719: true, docs: ['decl'], brand: 'БитумТех' },

  // ── Герметики и монтажная пена ───────────────────────────────────────────
  { name: 'ООО «Пенохим»', cat: 'sealants', products: ['mounting_foam', 'silicone_sealant'], role: 'MANUFACTURER', region: '50', city: 'Дзержинский', sme: 'MEDIUM', gisp: true, pp719: true, docs: ['decl'], website: true, fin: true, brand: 'Пенохим' },
  { name: 'ООО «Герметика»', cat: 'sealants', products: ['silicone_sealant', 'acrylic_sealant'], role: 'MANUFACTURER', region: '77', city: 'Москва', sme: 'SMALL', gisp: true, docs: ['decl'], brand: 'Герметика' },
  { name: 'ООО «Монтаж-Химия»', cat: 'sealants', products: ['mounting_foam', 'silicone_sealant', 'acrylic_sealant'], role: 'DISTRIBUTOR', region: '50', city: 'Лобня', sme: 'SMALL', docs: ['decl'], docFrom: 'ООО «Пенохим»', website: true },
  { name: 'ООО «ФомТек»', cat: 'sealants', products: ['mounting_foam'], role: 'MANUFACTURER', region: '40', city: 'Калуга', sme: 'SMALL', gisp: true, docs: ['decl'], brand: 'ФомТек' },
  { name: 'ООО «Акрил-Сервис»', cat: 'sealants', products: ['acrylic_sealant'], role: 'SUPPLIER', region: '77', city: 'Москва', sme: 'MICRO' },
  { name: 'ООО «Силикон-Центр»', cat: 'sealants', products: ['silicone_sealant'], role: 'MANUFACTURER', region: '71', city: 'Тула', sme: 'SMALL', docs: ['decl_other_product'], gisp: true, brand: 'СилЦентр' },
  { name: 'ООО «Уплотнитель Опт»', cat: 'sealants', products: ['silicone_sealant', 'mounting_foam'], role: 'UNKNOWN', region: '50', city: 'Реутов', sme: 'MICRO' },
  { name: 'ООО «ХимПромСинтез»', cat: 'sealants', products: ['mounting_foam'], role: 'MANUFACTURER', region: '52', city: 'Дзержинск', sme: 'MEDIUM', gisp: true, pp719: true, docs: ['decl'], stale: true, brand: 'ХПС' },
  { name: 'ООО «Пена-Экспресс»', cat: 'sealants', products: ['mounting_foam'], role: 'DISTRIBUTOR', region: '50', city: 'Мытищи', sme: 'SMALL', docs: ['decl'], docFrom: 'ООО «ФомТек»', young: true, risks: ['unreliable_address'] },
];

// ── Справочники ─────────────────────────────────────────────────────────────
const OKVED: Record<string, string> = {
  '20.30': 'Производство красок, лаков и аналогичных материалов для нанесения покрытий, полиграфических красок и мастик',
  '20.52': 'Производство клеев',
  '22.21': 'Производство плит, листов, труб и профилей из пластмасс',
  '23.52': 'Производство извести и гипса',
  '23.62': 'Производство изделий из гипса для использования в строительстве',
  '23.64': 'Производство сухих бетонных смесей',
  '23.99': 'Производство прочей неметаллической минеральной продукции, не включенной в другие группировки',
  '25.11': 'Производство строительных металлических конструкций, изделий и их частей',
  '25.94': 'Производство крепежных изделий',
  '46.73': 'Торговля оптовая лесоматериалами, строительными материалами и санитарно-техническим оборудованием',
  '46.74': 'Торговля оптовая скобяными изделиями, водопроводным и отопительным оборудованием и принадлежностями',
  '46.75': 'Торговля оптовая химическими продуктами',
  '46.90': 'Торговля оптовая неспециализированная',
  '47.52': 'Торговля розничная скобяными изделиями, лакокрасочными материалами и стеклом в специализированных магазинах',
  '49.41': 'Деятельность автомобильного грузового транспорта',
  '52.10': 'Деятельность по складированию и хранению',
};

const PRODUCT_OKVED: Record<string, string> = { eps: '22.21', xps: '22.21', pir: '22.21', pvc_membrane: '22.21', metal_tile: '25.11' };

const CHARACTERISTICS: Record<string, Record<string, string>> = {
  paint_construction: { 'Основа': 'акриловая дисперсия', 'Фасовка': 'ведро 14 кг, 45 кг', 'Расход': '150–200 г/м²' },
  paint_facade: { 'Основа': 'акрилат', 'Фасовка': 'ведро 25 кг', 'Морозостойкость': 'до −40 °C при хранении' },
  paint_interior: { 'Основа': 'водно-дисперсионная', 'Степень блеска': 'глубокоматовая', 'Фасовка': 'ведро 10 л' },
  primer: { 'Тип': 'глубокого проникновения', 'Фасовка': 'канистра 10 л' },
  enamel: { 'Тип': 'алкидная ПФ-115', 'Фасовка': 'банка 2,7 кг, ведро 20 кг' },
  varnish: { 'Тип': 'акрил-уретановый', 'Фасовка': 'банка 0,9 л, 2,5 л' },
  plaster: { 'Основа': 'гипс', 'Фасовка': 'мешок 30 кг', 'Толщина слоя': '5–50 мм' },
  putty: { 'Основа': 'полимерная', 'Фасовка': 'мешок 20 кг' },
  tile_adhesive: { 'Класс': 'C1 T', 'Фасовка': 'мешок 25 кг' },
  floor_mix: { 'Толщина слоя': '3–100 мм', 'Фасовка': 'мешок 25 кг' },
  masonry_mix: { 'Марка': 'М150', 'Фасовка': 'мешок 40 кг' },
  mineral_wool: { 'Плотность': '35–150 кг/м³', 'Группа горючести': 'НГ', 'Формат': 'плита 1000×600 мм' },
  eps: { 'Марка': 'ПСБ-С 25', 'Формат': 'плита 1000×1000 мм' },
  xps: { 'Прочность на сжатие': '250 кПа', 'Формат': 'плита 1185×585 мм' },
  pir: { 'Облицовка': 'фольга', 'Формат': 'плита 1200×600 мм' },
  screws: { 'Покрытие': 'цинк', 'Стандарт': 'DIN 7504' },
  wood_screws: { 'Покрытие': 'жёлтый цинк', 'Стандарт': 'DIN 7505' },
  anchors: { 'Материал': 'сталь 10', 'Размеры': 'М8–М20' },
  dowels: { 'Материал': 'полипропилен', 'Размеры': '6–12 мм' },
  bolts_nuts: { 'Класс прочности': '8.8', 'Стандарт': 'ГОСТ 7798-70' },
  roll_waterproofing: { 'Основа': 'полиэфир', 'Рулон': '10 м²' },
  bitumen_mastic: { 'Тип': 'битумно-полимерная', 'Фасовка': 'ведро 20 кг' },
  pvc_membrane: { 'Толщина': '1,2–2,0 мм', 'Рулон': '2,1×20 м' },
  metal_tile: { 'Толщина металла': '0,45–0,5 мм', 'Покрытие': 'полиэстер' },
  mounting_foam: { 'Тип': 'профессиональная, под пистолет', 'Объём баллона': '750 мл' },
  silicone_sealant: { 'Тип': 'санитарный, нейтральный', 'Картридж': '280 мл' },
  acrylic_sealant: { 'Тип': 'шовный', 'Картридж': '310 мл' },
};

const REGIONS: Record<string, string> = {
  '77': 'Москва', '50': 'Московская область', '71': 'Тульская область', '40': 'Калужская область', '69': 'Тверская область',
  '33': 'Владимирская область', '62': 'Рязанская область', '76': 'Ярославская область', '78': 'Санкт-Петербург',
  '16': 'Республика Татарстан', '52': 'Нижегородская область', '23': 'Краснодарский край',
};

const STREETS = ['Промышленная', 'Заводская', 'Индустриальная', 'Складская', 'Строителей', 'Лесная', 'Садовая', 'Энергетиков', 'Мира', 'Октябрьская', 'Новая', 'Полевая'];
const LAST = ['Соколов', 'Воронцов', 'Беляев', 'Ершов', 'Климов', 'Лаптев', 'Носков', 'Пахомов', 'Рябов', 'Степанов', 'Тихонов', 'Уваров', 'Фомин', 'Шубин', 'Яшин', 'Гусев', 'Жуков', 'Зимин', 'Иванов', 'Калинин'];
const FIRST = ['Алексей', 'Борис', 'Виктор', 'Григорий', 'Дмитрий', 'Евгений', 'Игорь', 'Константин', 'Максим', 'Николай', 'Олег', 'Павел', 'Роман', 'Сергей'];
const MIDDLE = ['Андреевич', 'Борисович', 'Викторович', 'Геннадьевич', 'Дмитриевич', 'Олегович', 'Павлович', 'Сергеевич', 'Юрьевич'];
const CERT_BODIES = [
  'ООО «Центр сертификации «Стандарт-Тест» (вымышленный орган)',
  'ООО «Испытательный центр «Регион-Эксперт» (вымышленный орган)',
  'АНО «Строй-Сертификат» (вымышленный орган)',
];

const SOURCE_URL: Record<string, string> = {
  FNS_EGRUL: 'https://egrul.nalog.ru/',
  FNS_PB: 'https://pb.nalog.ru/',
  SME_REGISTRY: 'https://rmsp.nalog.ru/search.html',
  GISP: 'https://gisp.gov.ru/goods/',
  GISP_PP719: 'https://gisp.gov.ru/pp719v2/pub/prod/',
  FSA_CERT: 'https://pub.fsa.gov.ru/rss/certificate',
  FSA_DECL: 'https://pub.fsa.gov.ru/rds/declaration',
  FAS_RNP: 'https://zakupki.gov.ru/epz/dishonestsupplier/search/results.html',
  FEDRESURS: 'https://bankrot.fedresurs.ru/',
  GIR_BO: 'https://bo.nalog.ru/',
};

const FRESH_DAYS: Record<string, number> = { FNS_EGRUL: 14, FNS_PB: 30, SME_REGISTRY: 35, GISP: 30, GISP_PP719: 30, FSA_CERT: 14, FSA_DECL: 14, FAS_RNP: 7, FEDRESURS: 7, GIR_BO: 365, MANUAL: 90 };

// ── Утилиты ─────────────────────────────────────────────────────────────────
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(r: () => number, arr: T[]): T => arr[Math.floor(r() * arr.length)];
const int = (r: () => number, min: number, max: number) => min + Math.floor(r() * (max - min + 1));
const digits = (r: () => number, n: number) => Array.from({ length: n }, () => int(r, 0, 9)).join('');

function innChecksum10(base9: string): string {
  const w = [2, 4, 10, 3, 5, 9, 4, 6, 8];
  const s = w.reduce((acc, k, i) => acc + k * Number(base9[i]), 0);
  return base9 + ((s % 11) % 10);
}

function innChecksum12(base10: string): string {
  const w1 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
  const w2 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
  const d11 = (w1.reduce((a, k, i) => a + k * Number(base10[i]), 0) % 11) % 10;
  const s11 = base10 + d11;
  const d12 = (w2.reduce((a, k, i) => a + k * Number(s11[i]), 0) % 11) % 10;
  return s11 + d12;
}

function ogrnChecksum(base: string, ip: boolean): string {
  const mod = ip ? 13n : 11n;
  return base + String((BigInt(base) % mod) % 10n);
}

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

function slugify(name: string): string {
  const inner = name.replace(/^(ООО|АО|ИП)\s*/u, '').replace(/[«»"]/g, '').toLowerCase();
  return inner
    .split('')
    .map((ch) => TRANSLIT[ch] ?? (/[a-z0-9]/.test(ch) ? ch : '-'))
    .join('')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

function ts(date: string, r: () => number): string {
  return `${date}T${String(int(r, 7, 18)).padStart(2, '0')}:${String(int(r, 0, 59)).padStart(2, '0')}:00Z`;
}

// ── Генерация ───────────────────────────────────────────────────────────────
const catalogPath = path.resolve(__dirname, '../../data/catalog.json');
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const productIndex = new Map<string, { name: string; okpd2: string; category: string }>();
for (const c of catalog.categories) for (const p of c.products) productIndex.set(p.id, { name: p.name, okpd2: p.okpd2, category: c.id });

const usedInn = new Set<string>();
const innByName = new Map<string, string>();
const declByName = new Map<string, { number: string; kind: 'DECLARATION' | 'CERTIFICATE' }[]>();

// Первый проход: реквизиты (нужны, чтобы дистрибьюторы ссылались на документы производителей)
for (const s of SPECS) {
  const r = rng(hashStr(s.name));
  let inn = '';
  do {
    inn = s.ip ? innChecksum12('00' + digits(r, 8)) : innChecksum10('00' + digits(r, 7));
  } while (usedInn.has(inn));
  usedInn.add(inn);
  innByName.set(s.name, inn);
}

const out: unknown[] = [];

for (const s of SPECS) {
  const r = rng(hashStr(s.name) ^ 0x9e3779b9);
  const inn = innByName.get(s.name)!;
  const regYear = s.young ? 2026 : int(r, 2004, 2021);
  const regDate = s.young ? `2026-02-${String(int(r, 10, 26)).padStart(2, '0')}` : `${regYear}-${String(int(r, 1, 12)).padStart(2, '0')}-${String(int(r, 1, 28)).padStart(2, '0')}`;
  const ogrn = s.ip
    ? ogrnChecksum('3' + String(regYear).slice(2) + '00' + digits(r, 9), true)
    : ogrnChecksum('1' + String(regYear).slice(2) + '00' + digits(r, 7), false);

  const checkedDay = s.stale ? `2026-03-${String(int(r, 2, 27)).padStart(2, '0')}` : `2026-09-${String(int(r, 18, 28)).padStart(2, '0')}`;
  const checkedAt = ts(checkedDay, r);
  const category = catalog.categories.find((c: { id: string }) => c.id === s.cat);
  const mainProduct = s.products[0];

  // ОКВЭД
  let okvedMain: string;
  let okvedAdd: string[];
  if (s.role === 'MANUFACTURER' || s.role === 'UNKNOWN') {
    okvedMain = PRODUCT_OKVED[mainProduct] ?? category.okved[0];
    okvedAdd = [...new Set([...category.okved.filter((c: string) => c !== okvedMain).slice(0, 1), '46.73', '52.10'])];
  } else if (s.role === 'DISTRIBUTOR') {
    okvedMain = s.cat === 'fasteners' ? '46.74' : s.cat === 'sealants' ? '46.75' : '46.73';
    okvedAdd = ['52.10', '49.41', '47.52'];
  } else {
    okvedMain = pick(r, ['46.90', '47.52']);
    okvedAdd = ['46.73'];
  }

  const director = s.ip ? s.name.replace(/^ИП\s*/, '') : `${pick(r, LAST)} ${pick(r, FIRST)} ${pick(r, MIDDLE)}`;
  const slug = slugify(s.name);
  const address = `${REGIONS[s.region]}, г. ${s.city}, ул. ${pick(r, STREETS)}, д. ${int(r, 1, 60)}${s.role === 'MANUFACTURER' ? `, стр. ${int(r, 1, 9)}` : ''}`;

  const verifications: unknown[] = [];
  const vr = (field: string, value: string, source: string, confidence: number, notes: string | null = null, date = checkedDay) => {
    verifications.push({
      field, value, source,
      source_url: SOURCE_URL[source] ?? '',
      checked_at: ts(date, r),
      fresh_until: ts(addDays(date, FRESH_DAYS[source] ?? 30), r),
      confidence, notes,
    });
  };

  const legalStatus = s.status ?? 'ACTIVE';
  vr('legal_status', legalStatus, 'FNS_EGRUL', 0.99, legalStatus === 'INACTIVE' ? 'Прекращение деятельности юридического лица путём исключения из ЕГРЮЛ' : null);
  vr('registration_date', regDate, 'FNS_EGRUL', 0.99);
  vr('okved_main', okvedMain, 'FNS_EGRUL', 0.99);
  vr('okved_additional', okvedAdd.join(','), 'FNS_EGRUL', 0.99);
  vr('director', director, 'FNS_EGRUL', 0.95);
  vr('address', address, 'FNS_EGRUL', 0.95);
  vr('region', s.region, 'FNS_EGRUL', 0.99);
  if (s.risks?.includes('unreliable_address')) vr('unreliable_address', 'true', 'FNS_EGRUL', 0.95, 'Запись о недостоверности сведений об адресе');

  if (s.sme) vr('sme_status', s.sme, 'SME_REGISTRY', 0.97, null);
  else vr('sme_status', 'NOT_FOUND', 'SME_REGISTRY', 0.9, 'Запись в реестре МСП не найдена');
  if (s.sme) vr('sme_included_at', s.young ? '2026-07-10' : `${Math.max(2016, regYear + 1)}-08-10`, 'SME_REGISTRY', 0.97);

  const employees = s.sme === 'MEDIUM' ? int(r, 101, 240) : s.sme === 'SMALL' ? int(r, 16, 95) : int(r, 1, 14);
  vr('employees_count', String(employees), 'FNS_PB', 0.9, 'Среднесписочная численность за 2025 год');
  vr('tax_regime', s.sme === 'MEDIUM' ? 'ОСН' : pick(r, ['УСН', 'ОСН']), 'FNS_PB', 0.9);
  vr('tax_debt', 'Не превышает 1000 руб.', 'FNS_PB', 0.85);

  // Документы
  const documents: { [k: string]: unknown }[] = [];
  const myDocs: { number: string; kind: 'DECLARATION' | 'CERTIFICATE' }[] = [];
  const manufacturerInn = s.docFrom ? innByName.get(s.docFrom)! : inn;
  const manufacturerName = s.docFrom ?? s.name;
  for (const kind of s.docs ?? []) {
    const yy = int(r, 24, 26);
    const validFrom = `20${yy}-${String(int(r, 1, 8)).padStart(2, '0')}-${String(int(r, 1, 28)).padStart(2, '0')}`;
    const isDecl = kind === 'decl' || kind === 'decl_expired' || kind === 'decl_other_product';
    const docType = isDecl ? 'DECLARATION' : 'CERTIFICATE';
    let number: string;
    if (kind === 'fire') number = `НСОПБ.RU.ПР${int(r, 100, 999)}.Н.${digits(r, 5)}`;
    else if (isDecl) number = `ЕАЭС N RU Д-RU.РА0${int(r, 1, 9)}.В.${digits(r, 5)}/${yy}`;
    else number = `РОСС RU.НА${int(r, 10, 99)}.Н${digits(r, 5)}`;
    let status = 'ACTIVE';
    let validTo = addDays(validFrom, kind === 'fire' ? 365 * 3 : 365 * 5);
    let productId = s.products[documents.length % s.products.length];
    let productName = `${productIndex.get(productId)!.name} ${s.brand ? `«${s.brand}»` : ''}`.trim();
    if (kind === 'decl_expired') {
      status = 'ARCHIVED';
      validTo = `2026-0${int(r, 4, 7)}-${String(int(r, 1, 28)).padStart(2, '0')}`;
    }
    if (kind === 'cert_suspended') status = 'SUSPENDED';
    if (kind === 'decl_other_product') {
      productId = '';
      productName = 'Смесь сухая для ремонта бетона (не совпадает с запрошенным товаром)';
    }
    const source = docType === 'DECLARATION' ? 'FSA_DECL' : 'FSA_CERT';
    documents.push({
      document_type: docType,
      number,
      status,
      manufacturer_inn: manufacturerInn,
      manufacturer_name: manufacturerName,
      applicant: s.name,
      product_id: productId || null,
      product_name: productName,
      tech_regulation: kind === 'fire'
        ? 'Федеральный закон №123-ФЗ «Технический регламент о требованиях пожарной безопасности»'
        : 'Добровольное подтверждение соответствия (система ГОСТ Р)',
      certification_body: docType === 'CERTIFICATE' ? pick(r, CERT_BODIES) : null,
      valid_from: validFrom,
      valid_to: validTo,
      source,
      source_url: SOURCE_URL[source],
      checked_at: checkedAt,
    });
    myDocs.push({ number, kind: docType });
  }
  declByName.set(s.name, myDocs);

  // Продукция
  const products = s.products.map((pid, i) => {
    const p = productIndex.get(pid)!;
    const inGisp = !!s.gisp && s.role === 'MANUFACTURER';
    const inPp719 = inGisp && !!s.pp719 && i < 2;
    return {
      category_id: p.category,
      product_id: pid,
      title: s.role === 'MANUFACTURER' || s.role === 'UNKNOWN'
        ? `${p.name}${s.brand ? ` «${s.brand}»` : ''}`
        : `${p.name}${s.docFrom ? ` (изготовитель — ${s.docFrom})` : ''}`,
      brand: s.role === 'MANUFACTURER' ? s.brand ?? null : null,
      model: s.role === 'MANUFACTURER' ? `${(s.brand ?? 'M').slice(0, 3).toUpperCase()}-${int(r, 100, 990)}` : null,
      okpd2: p.okpd2,
      origin: inGisp ? 'GISP' : 'MANUAL_TEST_DATA',
      gisp_record_number: inGisp ? `П-${digits(r, 7)}` : null,
      pp719_record_number: inPp719 ? `719-${int(r, 2023, 2026)}-${digits(r, 6)}` : null,
      russian_origin_confirmed: inPp719,
      characteristics: CHARACTERISTICS[pid] ?? {},
      source: inGisp ? (inPp719 ? 'GISP_PP719' : 'GISP') : 'MANUAL',
      source_url: inGisp ? (inPp719 ? SOURCE_URL.GISP_PP719 : SOURCE_URL.GISP) : '',
      updated_at: checkedAt,
    };
  });

  // Тип поставщика и основание (не только по ОКВЭД)
  let typeBasis: string;
  let typeConfidence: number;
  const ownDecl = myDocs.find((d) => d.kind === 'DECLARATION');
  const ownCert = myDocs.find((d) => d.kind === 'CERTIFICATE');
  const gispRec = products.find((p) => p.gisp_record_number);
  if (s.role === 'MANUFACTURER') {
    const parts: string[] = [];
    if (ownDecl && !s.docFrom) parts.push(`указан изготовителем в декларации ${ownDecl.number}`);
    if (ownCert && !s.docFrom) parts.push(`указан изготовителем в сертификате ${ownCert.number}`);
    if (gispRec) parts.push(`производитель продукции в каталоге ГИСП (запись ${gispRec.gisp_record_number})`);
    if (!parts.length) throw new Error(`Нет основания для статуса производителя: ${s.name}`);
    typeBasis = parts.join('; ');
    typeConfidence = parts.length > 1 ? 0.95 : 0.85;
  } else if (s.role === 'DISTRIBUTOR') {
    typeBasis = s.docFrom && myDocs.length
      ? `заявитель в документе ${myDocs[0].number}, изготовитель — ${s.docFrom}`
      : 'дистрибьюторский договор с производителем (ручная проверка)';
    typeConfidence = 0.7;
  } else if (s.role === 'SUPPLIER') {
    typeBasis = 'торговая компания: собственное производство и дистрибьюторские договоры не подтверждены';
    typeConfidence = 0.6;
  } else {
    typeBasis = 'найден только ОКВЭД производства — этого недостаточно, чтобы определить тип поставщика';
    typeConfidence = 0.2;
  }
  vr('supplier_type', s.role, 'MANUAL', typeConfidence, typeBasis);
  if (s.conflict) vr('supplier_type_claim', 'MANUFACTURER', 'MANUAL', 0.5, 'Сайт компании называет её производителем, но в декларации изготовителем указана другая организация');

  // Риск-сигналы — только официальные факты
  const risks: unknown[] = [];
  for (const risk of s.risks ?? []) {
    if (risk === 'rnp') {
      risks.push({
        kind: 'RNP', title: 'Запись в реестре недобросовестных поставщиков',
        details: 'Уклонение от заключения контракта по 44-ФЗ', record_number: `РНП.${digits(r, 6)}-25`,
        published_at: `2025-${String(int(r, 3, 11)).padStart(2, '0')}-${String(int(r, 1, 28)).padStart(2, '0')}`,
        source: 'FAS_RNP', source_url: SOURCE_URL.FAS_RNP, checked_at: checkedAt,
      });
    } else if (risk === 'bankruptcy_intent') {
      risks.push({
        kind: 'BANKRUPTCY_INTENT', title: 'Сообщение о намерении кредитора обратиться в суд с заявлением о банкротстве',
        details: 'Сообщение опубликовано кредитором; процедура банкротства не введена', record_number: `${digits(r, 8)}`,
        published_at: `2026-0${int(r, 6, 8)}-${String(int(r, 1, 28)).padStart(2, '0')}`,
        source: 'FEDRESURS', source_url: SOURCE_URL.FEDRESURS, checked_at: checkedAt,
      });
    } else if (risk === 'unreliable_address') {
      risks.push({
        kind: 'UNRELIABLE_INFO', title: 'Сведения об адресе признаны недостоверными',
        details: 'В ЕГРЮЛ внесена запись о недостоверности сведений об адресе юридического лица', record_number: `ГРН ${digits(r, 13)}`,
        published_at: `2026-0${int(r, 5, 8)}-${String(int(r, 1, 28)).padStart(2, '0')}`,
        source: 'FNS_EGRUL', source_url: SOURCE_URL.FNS_EGRUL, checked_at: checkedAt,
      });
    }
  }

  // Финансы (ГИР БО)
  const financials: unknown[] = [];
  if (s.fin) {
    const base = s.sme === 'MEDIUM' ? int(r, 800_000, 3_000_000) : s.sme === 'SMALL' ? int(r, 120_000, 800_000) : int(r, 10_000, 120_000);
    for (const year of [2024, 2025]) {
      const revenue = Math.round(base * (year === 2025 ? 1 + (r() - 0.3) * 0.3 : 1));
      const profit = Math.round(revenue * (r() * 0.12 - 0.02));
      const assets = Math.round(revenue * (0.5 + r() * 0.6));
      const liabilities = Math.round(assets * (0.3 + r() * 0.4));
      financials.push({
        period_year: year, revenue, assets, profit, liabilities, capital: assets - liabilities,
        source: 'GIR_BO', source_url: SOURCE_URL.GIR_BO, checked_at: checkedAt,
      });
    }
  }

  out.push({
    inn,
    ogrn,
    kpp: s.ip ? null : `00${String(int(r, 1, 99)).padStart(2, '0')}01001`,
    name: s.name,
    entity_type: s.ip ? 'IP' : 'LEGAL_ENTITY',
    legal_status: legalStatus,
    registration_date: regDate,
    region_code: s.region,
    region_name: REGIONS[s.region],
    city: s.city,
    address,
    okved_main: { code: okvedMain, name: OKVED[okvedMain] },
    okved_additional: okvedAdd.map((code) => ({ code, name: OKVED[code] })),
    director,
    sme_status: s.sme ?? 'NOT_FOUND',
    supplier_type: s.role,
    supplier_type_confidence: typeConfidence,
    supplier_type_basis: typeBasis,
    website: s.website ? `https://${slug}.example` : null,
    phone: `+7 (000) 000-${String(int(r, 10, 99))}-${String(int(r, 10, 99))}`,
    email: s.website ? `info@${slug}.example` : null,
    checked_at: checkedAt,
    products,
    documents,
    verifications,
    risks,
    financials,
  });
}

const target = path.resolve(__dirname, '../../data/suppliers.json');
fs.writeFileSync(
  target,
  JSON.stringify(
    {
      generated_at: '2026-09-29',
      source_type: 'MANUAL_TEST_DATA',
      notice: 'Все компании вымышленные. ИНН/ОГРН начинаются с несуществующего кода региона «00». Не использовать как официальные сведения.',
      suppliers: out,
    },
    null,
    2,
  ) + '\n',
  'utf8',
);
console.log(`Сгенерировано поставщиков: ${out.length} → ${target}`);
