// Default Store set-up. Saved once into settings.store_config, then editable by Owner/Admin in Store → Setup.
// Supply suggestions are based on typical Indian institute stationery & housekeeping indents
// (e.g. RIESI Bengaluru 2022-23 list) plus coaching-centre needs (exam printing, admission kits, pantry, first aid).
const S = (name, unit) => ({ name, unit });

module.exports = {
  session: '2026-27',
  module: {
    courses: [
      { name: 'Foundation', classes: ['6th', '7th', '8th', '9th', '10th'], subjects: ['Physics', 'Chemistry', 'Biology', 'Mathematics', 'SST', 'MAT', 'English'] },
      { name: 'NEET', classes: ['11th', '12th', 'Dropper'], subjects: ['Physics', 'Chemistry', 'Botany', 'Zoology'] },
      { name: 'IIT-JEE', classes: ['11th', '12th', 'Dropper'], subjects: ['Physics', 'Chemistry', 'Mathematics'] }
    ],
    languages: ['English', 'Hindi', 'Bilingual'],
    sources: ['Head office', 'Printer', 'Publisher / vendor', 'Other branch']
  },
  apparel: {
    garments: ['T-shirt', 'Polo T-shirt', 'Shirt', 'Trouser', 'Skirt', 'Jacket', 'Hoodie / Sweatshirt', 'Blazer', 'Cap', 'ID card lanyard', 'Apron / Lab coat', 'Housekeeping uniform', 'Security uniform'],
    sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '28', '30', '32', '34', '36', '38', '40', 'Free size'],
    audiences: ['Students', 'Teachers', 'Non-academic staff'],
    genders: ['Unisex', 'Boys / Male', 'Girls / Female'],
    colours: ['Navy blue', 'White', 'Maroon', 'Black', 'Grey', 'Orange', 'Teal', 'Sky blue']
  },
  supply: {
    categories: {
      'Housekeeping & cleaning': [S('Floor cleaner (5 L can)', 'can'), S('Phenyl (5 L can)', 'can'), S('Toilet cleaner – Harpic (500 ml)', 'bottle'), S('Acid / tile cleaner (5 L)', 'can'), S('Detergent powder (1 kg)', 'packet'), S('Glass cleaner – Colin (500 ml)', 'bottle'), S('Soft broom (phool jhadu)', 'pcs'), S('Hard broom (seenk jhadu)', 'pcs'), S('Mop stick with refill', 'pcs'), S('Mop refill', 'pcs'), S('Wiper', 'pcs'), S('Dusting cloth / duster', 'pcs'), S('Cobweb remover stick', 'pcs'), S('Garbage bags – large (roll)', 'roll'), S('Garbage bags – small (roll)', 'roll'), S('Dustbin', 'pcs'), S('Bucket (20 L)', 'pcs'), S('Mug', 'pcs'), S('Rubber hand gloves', 'pair'), S('Scrubber / steel brush', 'pcs'), S('Room freshener', 'pcs'), S('Naphthalene balls', 'packet')],
      'Washroom & hygiene': [S('Hand wash liquid (refill 5 L)', 'can'), S('Hand wash with pump', 'bottle'), S('Hand sanitizer (5 L)', 'can'), S('Toilet paper roll', 'roll'), S('Tissue paper box', 'box'), S('Paper napkins', 'packet'), S('Urinal cubes', 'packet'), S('Toilet brush', 'pcs'), S('Sanitary pads (for washroom kit)', 'packet'), S('Odonil / air freshener block', 'pcs')],
      'Stationery & office': [S('A4 paper (75 GSM ream)', 'ream'), S('Legal paper (ream)', 'ream'), S('Ball pen (blue)', 'pcs'), S('Ball pen (black / red)', 'pcs'), S('Pencil', 'pcs'), S('Eraser', 'pcs'), S('Sharpener', 'pcs'), S('Register (200 pages)', 'pcs'), S('Long register (100 pages)', 'pcs'), S('Stapler', 'pcs'), S('Stapler pins (box)', 'box'), S('Gem clips (box)', 'box'), S('Binder clips (box)', 'box'), S('File folder', 'pcs'), S('Box file', 'pcs'), S('Brown envelope (A4)', 'pcs'), S('White envelope', 'pcs'), S('Cello tape', 'roll'), S('Brown tape', 'roll'), S('Glue stick', 'pcs'), S('Scissors', 'pcs'), S('Sticky notes', 'pad'), S('Highlighter', 'pcs'), S('Rubber bands', 'packet'), S('Calculator', 'pcs'), S('Receipt book', 'pcs'), S('Rubber stamp ink', 'bottle')],
      'Classroom & teaching aids': [S('Whiteboard marker (black)', 'pcs'), S('Whiteboard marker (blue / red / green)', 'pcs'), S('Marker ink refill', 'bottle'), S('Whiteboard duster', 'pcs'), S('Whiteboard cleaner spray', 'bottle'), S('Chalk box (white)', 'box'), S('Chalk box (colour)', 'box'), S('Laser pointer / presenter', 'pcs'), S('Projector remote batteries (AA)', 'pcs'), S('Geometry box (demo)', 'pcs'), S('Charts / maps', 'pcs'), S('Attendance register', 'pcs')],
      'Printing & exam material': [S('Printer toner / cartridge', 'pcs'), S('Printer ink bottle (black)', 'bottle'), S('Printer ink bottle (colour)', 'bottle'), S('OMR sheets', 'pcs'), S('Answer sheets / copies', 'pcs'), S('Question paper printing (set)', 'set'), S('Admit card cards / sheets', 'pcs'), S('Exam envelopes (sealed)', 'pcs'), S('Photocopy paper', 'ream'), S('Lamination pouches', 'packet'), S('Spiral binding rings', 'packet')],
      'Admission & marketing kit': [S('Admission kit bag', 'pcs'), S('Brochures / prospectus', 'pcs'), S('Pamphlets / leaflets', 'pcs'), S('Standee / banner', 'pcs'), S('Student ID card', 'pcs'), S('ID card holder / lanyard', 'pcs'), S('Welcome kit file', 'pcs'), S('Result poster', 'pcs'), S('Visiting cards (box)', 'box')],
      'Pantry & refreshments': [S('Tea leaves / tea bags', 'packet'), S('Coffee', 'jar'), S('Sugar (1 kg)', 'kg'), S('Milk', 'litre'), S('Biscuits', 'packet'), S('Drinking water (20 L jar)', 'jar'), S('Packaged water bottles (case)', 'case'), S('Paper cups', 'packet'), S('Disposable plates', 'packet'), S('Dish wash liquid / bar', 'pcs'), S('Kitchen napkins', 'packet')],
      'Electrical & maintenance': [S('LED tube light (20 W)', 'pcs'), S('LED bulb (9 W)', 'pcs'), S('Extension board', 'pcs'), S('Batteries AA', 'pcs'), S('Batteries AAA', 'pcs'), S('Switch / socket', 'pcs'), S('Electrical tape', 'roll'), S('Fuse / MCB', 'pcs'), S('Fan regulator', 'pcs'), S('Tap / plumbing fitting', 'pcs'), S('Door lock / padlock', 'pcs'), S('Screws & nails (packet)', 'packet'), S('AC remote', 'pcs')],
      'IT & electronics': [S('Mouse', 'pcs'), S('Keyboard', 'pcs'), S('HDMI cable', 'pcs'), S('VGA cable', 'pcs'), S('Pen drive', 'pcs'), S('Webcam', 'pcs'), S('Headphones / mic', 'pcs'), S('LAN cable', 'pcs'), S('Printer', 'pcs'), S('Biometric device', 'pcs'), S('CCTV hard disk', 'pcs')],
      'First aid & safety': [S('First aid kit (complete)', 'kit'), S('Bandage roll', 'pcs'), S('Band-aid strips (box)', 'box'), S('Antiseptic liquid – Dettol / Savlon', 'bottle'), S('Cotton roll', 'pcs'), S('Pain relief spray / ointment', 'pcs'), S('ORS packets', 'packet'), S('Thermometer', 'pcs'), S('Face masks (box)', 'box'), S('Fire extinguisher', 'pcs'), S('Fire extinguisher refill', 'pcs'), S('Emergency torch', 'pcs')]
    }
  },
  departments: ['Students', 'Teachers / Academics', 'Non-academic staff', 'Housekeeping', 'Reception / Front office', 'Admin & Accounts', 'Counselling & Sales', 'Security', 'Lab', 'Management', 'Pantry', 'Exam cell'],
  areas: ['Reception', 'Classrooms', 'Washrooms', 'Office', 'Pantry', 'Waiting area', 'Store', 'Corridors', 'Staff room', 'Library', 'Lab', 'Other']
};
