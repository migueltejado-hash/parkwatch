/* ParkWatch Quartier – Stammdaten
 * Tatbestände: Bundeseinheitlicher Tatbestandskatalog (BKat OWi, Stand der Quelle weg.li: 22.08.2024, 15.1 Aufl.;
 * Beträge ab 09.11.2021). `verified:false` = TBNR oder Betrag NICHT gegen die amtliche Quelle bestätigt -> vor
 * Verwendung gegenüber der Behörde prüfen (https://www.weg.li/charges).
 * Eigene Tatbestände können unten in `TATBESTAENDE` ergänzt werden.
 */
const CATALOG_STAND = '31.10.2026';

/* dur: 0 = ohne Dauer, 1 = > 1 Stunde, 3 = > 3 Stunden
 * beh = "und behinderten dadurch Andere", gef = "und gefährdeten dadurch Andere",
 * rettung = Restbreite reicht für Rettungsfahrzeuge nicht mehr */
const TATBESTAENDE = [
  { id: 'gehweg', icon: 'fa-person-walking', label: 'Gehweg', law: '§ 12 Abs. 4 StVO',
    items: [
      { tbnr: '112454', text: 'Sie parkten verbotswidrig auf dem Gehweg.', euro: 55, pts: 0, dur: 0, verified: true },
      { tbnr: '112655', text: 'Sie parkten verbotswidrig auf dem Gehweg und behinderten dadurch Andere.', euro: 70, pts: 1, dur: 0, beh: true, verified: true },
      { tbnr: '112656', text: 'Sie parkten länger als 1 Stunde verbotswidrig auf dem Gehweg.', euro: 70, pts: 1, dur: 1, verified: true },
      { tbnr: '112657', text: 'Sie parkten länger als 1 Stunde verbotswidrig auf dem Gehweg und behinderten dadurch Andere.', euro: 80, pts: 1, dur: 1, beh: true, verified: true },
      { tbnr: '112658', text: 'Sie parkten verbotswidrig auf dem Gehweg und gefährdeten dadurch Andere.', euro: 80, pts: 1, dur: 0, gef: true, verified: true }
    ] },
  { id: 'kreuz_vor', icon: 'fa-road', label: 'Kreuzung/Einm. – davor (< 5 m)', law: '§ 12 Abs. 3 Nr. 1 StVO',
    items: [
      { tbnr: '112262', text: 'Sie parkten weniger als 5 Meter vor der Kreuzung/Einmündung.', euro: 10, pts: 0, dur: 0, verified: true },
      { tbnr: '112263', text: 'Sie parkten weniger als 5 Meter vor der Kreuzung/Einmündung und behinderten dadurch Andere.', euro: 15, pts: 0, dur: 0, beh: true, verified: true },
      { tbnr: '112264', text: 'Sie parkten länger als 3 Stunden weniger als 5 Meter vor der Kreuzung/Einmündung.', euro: 20, pts: 0, dur: 3, verified: true },
      { tbnr: '112265', text: 'Sie parkten länger als 3 Stunden weniger als 5 Meter vor der Kreuzung/Einmündung und behinderten dadurch Andere.', euro: 30, pts: 0, dur: 3, beh: true, verified: true }
    ] },
  { id: 'kreuz_hinter', icon: 'fa-road', label: 'Kreuzung/Einm. – dahinter (< 5 m)', law: '§ 12 Abs. 3 Nr. 1 StVO',
    items: [
      { tbnr: '112272', text: 'Sie parkten weniger als 5 Meter hinter der Kreuzung/Einmündung.', euro: 10, pts: 0, dur: 0, verified: true },
      { tbnr: '112273', text: 'Sie parkten weniger als 5 Meter hinter der Kreuzung/Einmündung und behinderten dadurch Andere.', euro: 15, pts: 0, dur: 0, beh: true, verified: true },
      { tbnr: '112274', text: 'Sie parkten länger als 3 Stunden weniger als 5 Meter hinter der Kreuzung/Einmündung.', euro: 20, pts: 0, dur: 3, verified: true }
    ] },
  { id: 'kreuz_radweg', icon: 'fa-bicycle', label: 'Kreuzung/Einm. – davor, Radweg (< 8 m)', law: '§ 12 Abs. 3 Nr. 1 StVO',
    items: [
      { tbnr: '112266', text: 'Sie parkten weniger als 8 Meter vor der Kreuzung/Einmündung, obwohl rechts neben der Fahrbahn ein Radweg baulich angelegt ist.', euro: 10, pts: 0, dur: 0, verified: true },
      { tbnr: '112267', text: '… und behinderten dadurch Andere.', euro: 15, pts: 0, dur: 0, beh: true, verified: true },
      { tbnr: '112268', text: '… länger als 3 Stunden.', euro: 20, pts: 0, dur: 3, verified: true },
      { tbnr: '112269', text: '… länger als 3 Stunden und behinderten dadurch Andere.', euro: 30, pts: 0, dur: 3, beh: true, verified: true }
    ] },
  { id: 'enge', icon: 'fa-arrows-left-right-to-line', label: 'Enge / unübersichtliche Stelle', law: '§ 12 Abs. 1 StVO',
    extra: { key: 'rettung', label: 'Rettungsfahrzeuge kämen nicht mehr durch' },
    items: [
      { tbnr: '112102', text: 'Sie parkten an einer engen/unübersichtlichen Straßenstelle.', euro: 35, pts: 0, dur: 0, verified: true },
      { tbnr: '112103', text: 'Sie parkten an einer engen/unübersichtlichen Straßenstelle und behinderten dadurch den fließenden Verkehr.', euro: 55, pts: 0, dur: 0, beh: true, verified: true },
      { tbnr: '112600', text: 'Sie parkten an einer engen/unübersichtlichen Straßenstelle. Bei der vorhandenen Restfahrbahnbreite war eine Durchfahrt für Rettungsfahrzeuge im Einsatz nicht mehr gewährleistet.', euro: 100, pts: 1, dur: 0, rettung: true, verified: true }
    ] },
  { id: 'feuerwehr', icon: 'fa-fire-extinguisher', label: 'Feuerwehrzufahrt', law: '§ 12 Abs. 1 StVO',
    behLabel: 'Rettungsfahrzeug im Einsatz behindert',
    items: [
      { tbnr: '112216', text: 'Sie parkten vor oder in einer amtlich gekennzeichneten Feuerwehrzufahrt.', euro: 55, pts: 0, dur: 0, verified: true },
      { tbnr: '112612', text: 'Sie parkten vor oder in einer amtlich gekennzeichneten Feuerwehrzufahrt und behinderten dadurch ein Rettungsfahrzeug im Einsatz.', euro: 100, pts: 1, dur: 0, beh: true, verified: true }
    ] },
  { id: 'lkw', icon: 'fa-truck', label: 'Schwerfahrzeug im Wohngebiet', law: '§ 12 Abs. 3a StVO',
    items: [
      { tbnr: '112396', text: 'Sie parkten Ihr Kraftfahrzeug mit einer zulässigen Gesamtmasse von mehr als 7,5 t regelmäßig in einem besonderen Gebiet, obwohl dies für diese Zeit verboten war.', euro: 30, pts: 0, dur: 0, verified: false,
        hint: 'Betrag nach 2021 nicht bestätigt (30 € laut Katalog 2014). Anhänger > 2 t: eigene TBNR.' }
    ] },
  { id: 'sonst', icon: 'fa-pen', label: 'Sonstiger Verstoß (frei)', law: '',
    custom: true, items: []
  }
];

/* Fahrzeugklassen */
const VEHICLE_TYPES = ['PKW', 'Transporter', 'LKW', 'Anhänger', 'Wohnmobil', 'Zweirad'];

const VEHICLE_COLORS = [
  ['Weiß', '#f8fafc'], ['Schwarz', '#0f172a'], ['Grau/Silber', '#94a3b8'], ['Blau', '#3b82f6'],
  ['Rot', '#ef4444'], ['Grün', '#22c55e'], ['Gelb/Orange', '#f59e0b'], ['Braun/Beige', '#a16207']
];

/* Marken -> [Standardklasse, Modelle]. Freitext bleibt immer möglich. */
const BRANDS = {
  'Volkswagen': ['PKW', ['Golf', 'Polo', 'Passat', 'Tiguan', 'T-Roc', 'T-Cross', 'Touran', 'Touareg', 'Arteon', 'up!', 'ID.3', 'ID.4', 'ID.5', 'ID.7', 'ID. Buzz', 'Sharan', 'Taigo', 'Caddy', 'Transporter T5', 'Transporter T6', 'Multivan', 'California', 'Crafter', 'Amarok', 'Käfer', 'Scirocco', 'Jetta', 'Lupo', 'Fox']],
  'Mercedes-Benz': ['PKW', ['A-Klasse', 'B-Klasse', 'C-Klasse', 'E-Klasse', 'S-Klasse', 'CLA', 'GLA', 'GLB', 'GLC', 'GLE', 'GLS', 'G-Klasse', 'V-Klasse', 'Vito', 'Sprinter', 'Citan', 'EQA', 'EQB', 'EQC', 'EQE', 'EQS', 'SLK/SL', 'Actros', 'Atego', 'Arocs', 'Unimog']],
  'BMW': ['PKW', ['1er', '2er', '3er', '4er', '5er', '6er', '7er', 'X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7', 'Z4', 'i3', 'i4', 'iX', 'iX1', 'iX3', 'Mini (BMW)', 'R 1250 GS (Motorrad)']],
  'Audi': ['PKW', ['A1', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'Q2', 'Q3', 'Q4 e-tron', 'Q5', 'Q7', 'Q8', 'e-tron', 'TT', 'R8', 'S3', 'RS6']],
  'Opel': ['PKW', ['Corsa', 'Astra', 'Insignia', 'Mokka', 'Crossland', 'Grandland', 'Zafira', 'Meriva', 'Adam', 'Karl', 'Combo', 'Vivaro', 'Movano', 'Vectra', 'Omega', 'Tigra']],
  'Ford': ['PKW', ['Fiesta', 'Focus', 'Mondeo', 'Kuga', 'Puma', 'Ka', 'Ka+', 'C-Max', 'S-Max', 'Galaxy', 'EcoSport', 'Explorer', 'Mustang', 'Mustang Mach-E', 'Ranger', 'Transit', 'Transit Custom', 'Transit Connect', 'Tourneo']],
  'Škoda': ['PKW', ['Fabia', 'Scala', 'Octavia', 'Superb', 'Kamiq', 'Karoq', 'Kodiaq', 'Enyaq', 'Citigo', 'Rapid', 'Roomster', 'Yeti']],
  'Seat': ['PKW', ['Ibiza', 'Leon', 'Arona', 'Ateca', 'Tarraco', 'Alhambra', 'Mii', 'Toledo']],
  'Cupra': ['PKW', ['Born', 'Formentor', 'Leon', 'Ateca', 'Tavascan']],
  'Renault': ['PKW', ['Clio', 'Twingo', 'Captur', 'Megane', 'Scenic', 'Kadjar', 'Arkana', 'Austral', 'Zoe', 'Kangoo', 'Trafic', 'Master', 'Talisman', 'Espace', 'Koleos']],
  'Peugeot': ['PKW', ['108', '208', '2008', '308', '3008', '408', '508', '5008', 'Rifter', 'Partner', 'Expert', 'Boxer', 'Traveller']],
  'Citroën': ['PKW', ['C1', 'C3', 'C3 Aircross', 'C4', 'C5', 'C5 Aircross', 'Berlingo', 'SpaceTourer', 'Jumpy', 'Jumper', 'Nemo', 'DS3']],
  'Fiat': ['PKW', ['500', '500X', '500L', 'Panda', 'Punto', 'Tipo', 'Doblò', 'Scudo', 'Ducato', 'Talento', 'Fiorino']],
  'Toyota': ['PKW', ['Aygo', 'Yaris', 'Yaris Cross', 'Corolla', 'C-HR', 'RAV4', 'Auris', 'Avensis', 'Prius', 'Camry', 'Hilux', 'Land Cruiser', 'Proace', 'Proace City', 'bZ4X', 'Verso']],
  'Honda': ['PKW', ['Jazz', 'Civic', 'CR-V', 'HR-V', 'e', 'Accord', 'ZR-V']],
  'Mazda': ['PKW', ['2', '3', '6', 'CX-3', 'CX-30', 'CX-5', 'CX-60', 'MX-5', 'MX-30']],
  'Nissan': ['PKW', ['Micra', 'Juke', 'Qashqai', 'X-Trail', 'Leaf', 'Note', 'Navara', 'NV200', 'Primastar', 'Ariya']],
  'Hyundai': ['PKW', ['i10', 'i20', 'i30', 'Bayon', 'Kona', 'Tucson', 'Santa Fe', 'Ioniq', 'Ioniq 5', 'Ioniq 6', 'ix35', 'H-1', 'Staria']],
  'Kia': ['PKW', ['Picanto', 'Rio', 'Ceed', 'Stonic', 'Sportage', 'Sorento', 'Niro', 'EV6', 'EV9', 'Soul', 'Stinger', 'XCeed']],
  'Dacia': ['PKW', ['Sandero', 'Duster', 'Logan', 'Jogger', 'Spring', 'Lodgy', 'Dokker']],
  'Suzuki': ['PKW', ['Swift', 'Vitara', 'S-Cross', 'Ignis', 'Jimny', 'Baleno', 'SX4', 'Across']],
  'Mitsubishi': ['PKW', ['Space Star', 'ASX', 'Eclipse Cross', 'Outlander', 'L200', 'Colt', 'Pajero']],
  'Subaru': ['PKW', ['Impreza', 'XV', 'Forester', 'Outback', 'Levorg', 'BRZ']],
  'Volvo': ['PKW', ['V40', 'V60', 'V90', 'S60', 'S90', 'XC40', 'XC60', 'XC90', 'EX30', 'EX90', 'C40']],
  'Mini': ['PKW', ['One', 'Cooper', 'Cooper S', 'Clubman', 'Countryman', 'Cabrio', 'Electric']],
  'Smart': ['PKW', ['fortwo', 'forfour', '#1', '#3']],
  'Porsche': ['PKW', ['911', 'Cayenne', 'Macan', 'Panamera', 'Taycan', '718 Boxster/Cayman']],
  'Tesla': ['PKW', ['Model 3', 'Model Y', 'Model S', 'Model X']],
  'Land Rover': ['PKW', ['Defender', 'Discovery', 'Discovery Sport', 'Range Rover', 'Range Rover Sport', 'Evoque', 'Velar', 'Freelander']],
  'Jeep': ['PKW', ['Renegade', 'Compass', 'Wrangler', 'Cherokee', 'Grand Cherokee', 'Avenger']],
  'Alfa Romeo': ['PKW', ['Giulietta', 'Giulia', 'Stelvio', 'MiTo', 'Tonale']],
  'Lexus': ['PKW', ['CT', 'UX', 'NX', 'RX', 'IS', 'ES']],
  'Jaguar': ['PKW', ['XE', 'XF', 'F-Pace', 'E-Pace', 'I-Pace', 'F-Type']],
  'MG': ['PKW', ['ZS', 'HS', 'MG4', 'MG5', 'Marvel R']],
  'BYD': ['PKW', ['Atto 3', 'Dolphin', 'Seal', 'Han', 'Tang']],
  'Polestar': ['PKW', ['2', '3', '4']],
  'Lancia': ['PKW', ['Ypsilon', 'Delta']],
  'Chevrolet': ['PKW', ['Aveo', 'Spark', 'Captiva', 'Cruze', 'Camaro', 'Corvette']],
  'Chrysler/Dodge': ['PKW', ['Voyager', 'Grand Voyager', 'Pacifica', 'RAM 1500']],
  'Iveco': ['Transporter', ['Daily', 'Daily Kastenwagen', 'Daily Pritsche', 'Eurocargo', 'Stralis', 'S-Way']],
  'MAN': ['LKW', ['TGE', 'TGL', 'TGM', 'TGS', 'TGX', 'Kipper TGS', 'Bus Lion\'s']],
  'Scania': ['LKW', ['R-Serie', 'S-Serie', 'G-Serie', 'P-Serie']],
  'DAF': ['LKW', ['XF', 'XG', 'CF', 'LF']],
  'Volvo Trucks': ['LKW', ['FH', 'FM', 'FL', 'FE']],
  'Renault Trucks': ['LKW', ['T', 'C', 'D', 'Master Pritsche']],
  'Mitsubishi Fuso': ['LKW', ['Canter', 'Fighter']],
  'Isuzu': ['LKW', ['D-Max', 'N-Serie']],
  'Hymer': ['Wohnmobil', ['B-Klasse', 'Exsis', 'Free', 'Camper Van']],
  'Dethleffs': ['Wohnmobil', ['Globebus', 'Trend', 'Esprit', 'Just Go']],
  'Knaus': ['Wohnmobil', ['Boxstar', 'Sun TI', 'Van TI']],
  'Hobby': ['Wohnmobil', ['Optima', 'Vantana', 'Wohnwagen']],
  'Adria': ['Wohnmobil', ['Twin', 'Matrix', 'Wohnwagen']],
  'Fendt': ['Wohnmobil', ['Wohnwagen Bianco', 'Caravan']],
  'Tabbert/Weinsberg/Bürstner': ['Wohnmobil', ['Wohnwagen', 'Wohnmobil']],
  'Anhänger (Marke unbekannt)': ['Anhänger', ['Kofferanhänger', 'Planenanhänger', 'Kipper', 'Pkw-Anhänger', 'Autotransporter', 'Bootsanhänger', 'Verkaufsanhänger', 'Wohnwagen']],
  'Humbaur': ['Anhänger', ['Kofferanhänger', 'Tandem', 'Kipper']],
  'Böckmann': ['Anhänger', ['Pferdeanhänger', 'Tandem']],
  'Brenderup': ['Anhänger', ['Pkw-Anhänger']],
  'Yamaha': ['Zweirad', ['MT-07', 'MT-09', 'R1', 'Tracer', 'NMAX']],
  'Honda (Motorrad)': ['Zweirad', ['CB', 'CBR', 'Africa Twin', 'PCX', 'Forza']],
  'Kawasaki': ['Zweirad', ['Z650', 'Z900', 'Ninja', 'Versys']],
  'Harley-Davidson': ['Zweirad', ['Sportster', 'Softail', 'Road King']],
  'Vespa/Piaggio': ['Zweirad', ['Vespa', 'Liberty', 'MP3']],
  'KTM': ['Zweirad', ['Duke', 'Adventure', 'EXC']]
};
