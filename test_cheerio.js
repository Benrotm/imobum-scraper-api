const fs = require('fs');
const cheerio = require('cheerio');
const html = fs.readFileSync('flux_show.html', 'utf8');
const $ = cheerio.load(html);

console.log('--- EXTRACTING FLUXMLS PROPOERTYSHOW DOM ---');
console.log('Title: ', $('h4.m-0').text().trim() || $('h1, h2, h3').first().text().trim());
console.log('Price: ', $('.property-show-price').text().trim());
console.log('Location: ', $('.property-show-zone').text().trim());
console.log('Rooms: ', $('div:contains("Camere:")').text().trim() || 'Missing');
console.log('Area: ', $('div:contains("utila:")').text().trim() || 'Missing');
console.log('Description: ', $('.promowindow h4:contains("Descriere")').nextAll('div.clearfix').length ? $('.promowindow h4:contains("Descriere")').nextAll('div.clearfix').first().next('p').text().trim().substring(0, 100) : $('.promowindow p').text().trim().substring(0, 100));
console.log('Agent: ', $('.agent_show h5').text().trim() || 'Missing');
console.log('Phone: ', $('.agent_show i.fa-phone').parent().text().trim() || 'Missing');
