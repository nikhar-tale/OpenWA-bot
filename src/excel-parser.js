const XLSX = require('xlsx');

/**
 * Common logic to map sheet rows into normalized Lead objects.
 */
function mapRowsToLeads(rows) {
  return rows.map((row, index) => {
    let name = '';
    let phone = '';

    for (const key of Object.keys(row)) {
      const normalizedKey = key.toLowerCase().replace(/[\s_-]/g, '');
      
      // Match "name", "customername", "leadname"
      if (normalizedKey === 'name' || normalizedKey === 'customername' || normalizedKey === 'leadname') {
        const val = String(row[key]).trim();
        if (val) name = val;
      }
      
      // Match "phone", "phonenumber", "mobile", "mobilenumber", "number"
      if (normalizedKey === 'phone' || normalizedKey === 'phonenumber' || normalizedKey === 'mobile' || normalizedKey === 'mobilenumber' || normalizedKey === 'number') {
        const val = String(row[key]).trim();
        if (val) phone = val;
      }
    }

    return {
      name,
      phone,
      originalData: row,
      status: 'PENDING',
      error: null,
      timestamp: null
    };
  });
}

/**
 * Parse an Excel (.xlsx) or CSV (.csv) file path.
 */
function parseLeadsFile(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  return mapRowsToLeads(rows);
}

/**
 * Parse an Excel (.xlsx) or CSV (.csv) memory buffer.
 */
function parseLeadsBuffer(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  return mapRowsToLeads(rows);
}

module.exports = {
  parseLeadsFile,
  parseLeadsBuffer
};
