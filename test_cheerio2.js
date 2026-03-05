const fs = require('fs');
const cheerio = require('cheerio');
const html = fs.readFileSync('flux_show.html', 'utf8');
const $ = cheerio.load(html);

console.log('--- FLUXMLS PROPERTYSHOW EXTRACTION ---');
console.log('Title: ', $('h1').first().text().trim());
console.log('Price: ', $('.property-show-price').first().text().trim());
console.log('Rooms: ', $('li:contains("Nr. camere") span').first().text().trim());
console.log('Area: ', $('li:contains("S. utila:") span').first().text().trim());
console.log('Location: ', $('.property-show-zone').text().trim());
console.log('Description: ', $('.promowindow:has(h4:contains("Descriere")) div').text().trim().replace(/\s+/g, ' ').substring(0, 100));
