// Built-in register definitions. Inserted once; afterwards fully editable in Register Builder.
const sel = (key, label, options, required = false) => ({ key, label, type: 'select', options, required });
const f = (key, label, type = 'text', required = false, extra = {}) => Object.assign({ key, label, type, required }, extra);

module.exports = [
  {
    key: 'security', name: 'Security / Guard Register', department: 'Security', responsible_role: 'guard',
    frequency: 'per_shift', deadline: '22:00', important: true, sort: 1,
    description: 'Shift log submitted by the guard on duty.',
    fields: [
      sel('shift', 'Shift', ['Morning', 'Afternoon', 'Night'], true),
      f('guard_name', 'Guard name', 'user', true),
      f('shift_start', 'Shift start', 'time'),
      f('shift_end', 'Shift end', 'time'),
      f('visitors', 'Visitors', 'number'),
      f('deliveries', 'Deliveries', 'number'),
      f('vehicles', 'Vehicles', 'number'),
      f('incidents', 'Incidents', 'number'),
      f('material_movement', 'Material movement', 'textarea'),
      f('opening_condition', 'Opening condition', 'textarea'),
      f('closing_condition', 'Closing condition', 'textarea'),
      f('remarks', 'Remarks', 'textarea'),
      f('attachment', 'Attachment', 'file'),
      f('signature', 'Signature', 'signature')
    ]
  },
  {
    key: 'visitor', name: 'Visitor Register', department: 'Security', responsible_role: 'guard',
    frequency: 'live', sort: 2, description: 'Check visitors in and out.',
    fields: [
      sel('visitor_type', 'Visitor is a', ['Parent', 'Student', 'Other'], true),
      f('visitor_type_other', 'Describe visitor (e.g. vendor, job applicant, relative)', 'text', true, { showIf: { field: 'visitor_type', equals: 'Other' } }),
      f('visitor_name', 'Visitor name', 'text', true),
      f('student_name', 'Student name / Saathi ID (if parent or student)', 'text', false, { showIf: { field: 'visitor_type', in: ['Parent', 'Student'] } }),
      f('phone', 'Mobile number', 'phone', true),
      f('alt_phone', 'Alternate number', 'phone'),
      f('email', 'Email', 'email'),
      f('address', 'Address / locality', 'text'),
      f('company', 'Organisation (if any)'),
      f('person_to_meet', 'Person to meet'),
      sel('purpose', 'Purpose of visit', ['Admission enquiry', 'Fee payment', 'Parent-teacher meeting', 'Counselling', 'Document submission', 'Result / test query', 'Attend class / test', 'Vendor / delivery', 'Interview', 'Official', 'Other'], true),
      f('purpose_details', 'Purpose details', 'textarea'),
      f('visitors_count', 'No. of people', 'number'),
      f('entry_time', 'Entry time', 'datetime', true, { defaultNow: true }),
      f('exit_time', 'Exit time', 'datetime'),
      f('vehicle_number', 'Vehicle number', 'vehicle'),
      sel('id_type', 'ID type', ['None', 'Aadhaar (last 4 digits only)', 'Driving licence', 'Company ID', 'Other']),
      f('id_reference', 'ID reference (last 4 digits only)', 'text', false, { maxLength: 4 }),
      f('pass_number', 'Pass number'),
      f('approved_by', 'Approved by'),
      f('remarks', 'Remarks', 'textarea')
    ]
  },
  {
    key: 'inward_outward', name: 'Inward / Outward Register', department: 'Security', responsible_role: 'guard',
    frequency: 'live', important: true, sort: 3,
    description: 'Material entering or leaving. Linked to inventory when an item is chosen.',
    fields: [
      sel('direction', 'Direction', ['Inward', 'Outward'], true),
      f('time', 'Time', 'time'),
      f('item', 'Inventory item (optional)', 'item'),
      f('material', 'Material', 'text', true),
      f('quantity', 'Quantity', 'number', true),
      f('unit', 'Unit'),
      f('sender', 'Sender'),
      f('receiver', 'Receiver'),
      f('purpose', 'Purpose'),
      f('vehicle', 'Vehicle', 'vehicle'),
      f('gate_pass_number', 'Gate pass number'),
      f('authorized_by', 'Authorised by'),
      f('handled_by', 'Handled by'),
      f('update_inventory', 'Update inventory stock', 'yesno'),
      f('photo', 'Photo', 'image'),
      f('remarks', 'Remarks', 'textarea')
    ]
  },
  {
    key: 'delivery', name: 'Delivery Register', department: 'Security', responsible_role: 'guard',
    frequency: 'live', sort: 4, description: 'Deliveries received at the gate.',
    fields: [
      sel('delivery_type', 'Delivery type', ['Inventory', 'Food', 'Equipment', 'Documents', 'Other'], true),
      f('from_vendor', 'From / vendor', 'text', true),
      f('items_description', 'Items', 'textarea'),
      f('quantity', 'Packages', 'number'),
      f('received_by', 'Received by'),
      f('time', 'Time', 'time'),
      f('photo', 'Photo', 'image'),
      f('remarks', 'Remarks', 'textarea')
    ]
  },
  {
    key: 'courier', name: 'Courier Register', department: 'Reception', responsible_role: 'staff',
    frequency: 'live', sort: 5, description: 'Incoming and outgoing couriers.',
    fields: [
      sel('direction', 'Incoming / Outgoing', ['Incoming', 'Outgoing'], true),
      sel('courier_type', 'Courier type', ['Document', 'Parcel', 'Books / Material', 'Other']),
      f('courier_company', 'Courier company'),
      f('tracking_number', 'Tracking number'),
      f('sender', 'Sender'),
      f('recipient', 'Recipient'),
      f('department', 'Department'),
      f('received_by', 'Received by'),
      f('delivered_to', 'Delivered to'),
      f('delivery_date', 'Delivery date', 'date'),
      sel('courier_status', 'Status', ['Received', 'Pending', 'Delivered', 'Returned'], true),
      f('attachment', 'Attachment', 'file'),
      f('remarks', 'Remarks', 'textarea')
    ]
  },
  {
    key: 'key', name: 'Key Register', department: 'Security', responsible_role: 'guard',
    frequency: 'live', sort: 6, description: 'Keys issued and returned.',
    fields: [
      f('key_id', 'Key ID'),
      f('key_name', 'Key name', 'text', true),
      f('location', 'Location'),
      f('issued_to', 'Issued to', 'text', true),
      f('issued_at', 'Issued at', 'datetime', false, { defaultNow: true }),
      f('returned_at', 'Returned at', 'datetime'),
      sel('condition', 'Condition', ['Good', 'Damaged']),
      sel('key_status', 'Status', ['Issued', 'Available', 'Lost', 'Damaged'], true),
      f('remarks', 'Remarks', 'textarea')
    ]
  },
  {
    key: 'vehicle', name: 'Vehicle Register', department: 'Transport', responsible_role: 'driver',
    frequency: 'daily', deadline: '20:00', sort: 7, description: 'Trips, kilometres and fuel.',
    fields: [
      f('vehicle_number', 'Vehicle number', 'vehicle', true),
      sel('vehicle_type', 'Vehicle type', ['Car', 'Van', 'Bus', 'Two-wheeler', 'Other']),
      f('driver', 'Driver', 'user'),
      f('start_km', 'Start KM', 'number'),
      f('end_km', 'End KM', 'number'),
      f('purpose', 'Purpose'),
      f('fuel_litres', 'Fuel (litres)', 'number'),
      f('fuel_cost', 'Fuel cost', 'currency'),
      f('parking', 'Parking'),
      f('issue', 'Issue'),
      f('remarks', 'Remarks', 'textarea')
    ]
  },
  {
    key: 'housekeeping', name: 'Housekeeping Register', department: 'Facilities', responsible_role: 'housekeeping',
    frequency: 'daily', deadline: '11:00', sort: 8, description: 'Area cleaning checklist with photos.',
    fields: [
      sel('area', 'Area', ['Reception', 'Classrooms', 'Washrooms', 'Office', 'Pantry', 'Waiting Area', 'Store', 'Corridors', 'Other'], true),
      f('cleaning_time', 'Cleaning time', 'time'),
      f('checklist', 'Checklist', 'checklist', false, { options: ['Floor cleaned', 'Dustbins emptied', 'Washrooms cleaned', 'Water available', 'Pantry cleaned', 'Classrooms ready'] }),
      f('issue_found', 'Issue found', 'textarea'),
      f('photo', 'Photo', 'image'),
      sel('task_status', 'Status', ['Done', 'Partly done', 'Not done']),
      f('remarks', 'Remarks', 'textarea')
    ]
  },
  {
    key: 'maintenance', name: 'Maintenance / Issue Register', department: 'Facilities', responsible_role: 'admin',
    frequency: 'as_needed', important: true, sort: 9, description: 'Any employee can report an issue; admin assigns and closes it.',
    fields: [
      f('issue', 'Issue', 'text', true),
      f('location', 'Location'),
      f('asset', 'Asset', 'asset'),
      sel('priority', 'Priority', ['Low', 'Medium', 'High', 'Critical'], true),
      f('description', 'Description', 'textarea'),
      f('photo', 'Photo', 'image'),
      f('assigned_to', 'Assigned to', 'user'),
      f('vendor', 'Vendor'),
      f('estimated_cost', 'Estimated cost', 'currency'),
      f('actual_cost', 'Actual cost', 'currency'),
      f('resolution', 'Resolution', 'textarea'),
      f('completion_date', 'Completion date', 'date'),
      sel('issue_status', 'Status', ['Open', 'Assigned', 'In progress', 'Resolved', 'Closed'], true, { default: 'Open' })
    ]
  },
  {
    key: 'incident', name: 'Incident Register', department: 'Security', responsible_role: 'guard',
    frequency: 'as_needed', important: true, sort: 10, description: 'Safety and security incidents. Critical ones go to the owner dashboard.',
    fields: [
      sel('incident_type', 'Incident type', ['Safety', 'Security', 'Medical', 'Fire', 'Theft / Loss', 'Property damage', 'Student conduct', 'Other'], true),
      sel('severity', 'Severity', ['Low', 'Medium', 'High', 'Critical'], true),
      f('time', 'Time', 'time'),
      f('location', 'Location'),
      f('description', 'Description', 'textarea', true),
      f('people_involved', 'People involved'),
      f('immediate_action', 'Immediate action', 'textarea'),
      f('responsible_person', 'Responsible person'),
      f('resolution', 'Resolution', 'textarea'),
      f('attachments', 'Attachment', 'file'),
      sel('incident_status', 'Status', ['Open', 'Investigating', 'Resolved', 'Closed'], true, { default: 'Open' })
    ]
  },
  {
    key: 'lost_found', name: 'Lost & Found Register', department: 'Reception', responsible_role: 'staff',
    frequency: 'as_needed', sort: 11, description: 'Items found on premises.',
    fields: [
      f('item', 'Item', 'text', true),
      f('found_date', 'Found date', 'date'),
      f('location', 'Location'),
      f('found_by', 'Found by'),
      f('description', 'Description', 'textarea'),
      f('photo', 'Photo', 'image'),
      f('storage_location', 'Storage location'),
      f('claimed_by', 'Claimed by'),
      f('claim_date', 'Claim date', 'date'),
      sel('lf_status', 'Status', ['Found', 'Under Verification', 'Claimed', 'Returned', 'Unclaimed', 'Disposed'], true, { default: 'Found' }),
      f('remarks', 'Remarks', 'textarea')
    ]
  },
  {
    key: 'opening', name: 'Opening Checklist', department: 'Operations', responsible_role: 'guard',
    frequency: 'daily', deadline: '09:30', important: true, sort: 12, description: 'Branch opening checks.',
    fields: [
      f('checklist', 'Opening checks', 'checklist', true, { options: ['Electricity', 'Internet', 'AC', 'Lights', 'CCTV', 'Reception', 'Classrooms', 'Washrooms', 'Water', 'Security', 'Cleanliness'] }),
      f('remarks', 'Remarks', 'textarea'),
      f('signature', 'Signature', 'signature')
    ]
  },
  {
    key: 'closing', name: 'Closing Checklist', department: 'Operations', responsible_role: 'guard',
    frequency: 'daily', deadline: '21:30', important: true, sort: 13, description: 'Branch closing checks.',
    fields: [
      f('checklist', 'Closing checks', 'checklist', true, { options: ['AC off', 'Lights off', 'Computers off', 'Doors checked', 'Windows checked', 'CCTV checked', 'Documents secured', 'Cash / petty cash secured', 'Water / electricity checked', 'Main gate locked'] }),
      f('remarks', 'Remarks', 'textarea'),
      f('signature', 'Signature', 'signature')
    ]
  },
  {
    key: 'staff_movement', name: 'Attendance / Staff Movement', department: 'Admin', responsible_role: 'guard',
    frequency: 'live', sort: 14, description: 'Staff going out for work and returning.',
    fields: [
      f('staff', 'Staff', 'user', true),
      sel('movement', 'Movement', ['Arrived', 'Out for work', 'Returned', 'Left for the day'], true),
      f('time', 'Time', 'datetime', true, { defaultNow: true }),
      f('purpose', 'Purpose'),
      f('remarks', 'Remarks')
    ]
  },
  {
    key: 'reception', name: 'Reception Register', department: 'Reception', responsible_role: 'staff',
    frequency: 'daily', deadline: '19:30', sort: 15, description: 'Daily front-desk summary.',
    fields: [
      f('calls_received', 'Calls received', 'number'),
      f('walk_ins', 'Walk-ins', 'number'),
      f('enquiries', 'Admission enquiries', 'number'),
      f('admissions', 'Admissions', 'number'),
      f('notes', 'Notes', 'textarea')
    ]
  },
  {
    key: 'utility', name: 'Electricity / Utility Register', department: 'Facilities', responsible_role: 'staff',
    frequency: 'daily', deadline: '20:00', sort: 16, description: 'Meter readings, generator and water.',
    fields: [
      f('meter_reading', 'Meter reading', 'number'),
      f('units_consumed', 'Units consumed', 'number'),
      f('generator_hours', 'Generator hours', 'number'),
      f('diesel_litres', 'Diesel (litres)', 'number'),
      f('water_tankers', 'Water tankers', 'number'),
      f('remarks', 'Remarks', 'textarea')
    ]
  },
  {
    key: 'equipment_handover', name: 'Equipment Handover Register', department: 'Admin', responsible_role: 'staff',
    frequency: 'as_needed', sort: 17, description: 'Laptops, projectors and other equipment handed over.',
    fields: [
      f('equipment', 'Equipment', 'asset', true),
      f('handed_by', 'Handed by', 'user'),
      f('handed_to', 'Handed to', 'text', true),
      f('handover_time', 'Handover time', 'datetime', false, { defaultNow: true }),
      sel('condition', 'Condition', ['Good', 'Fair', 'Damaged']),
      f('return_time', 'Return time', 'datetime'),
      f('remarks', 'Remarks'),
      f('signature', 'Signature', 'signature')
    ]
  },
  {
    key: 'meeting_room', name: 'Meeting Room Register', department: 'Admin', responsible_role: 'staff',
    frequency: 'as_needed', sort: 18, description: 'Room bookings.',
    fields: [
      f('room', 'Room', 'text', true),
      f('booked_by', 'Booked by', 'user'),
      f('purpose', 'Purpose'),
      f('start', 'Start', 'datetime', true),
      f('end', 'End', 'datetime'),
      f('attendees', 'Attendees', 'number'),
      f('remarks', 'Remarks')
    ]
  }
];
