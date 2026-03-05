const fs = require('fs');
const cheerio = require('cheerio');
const html = fs.readFileSync('immoflux_slidepanel.html', 'utf8');
const $ = cheerio.load(html);

const descText = $('div').filter(function () { return $(this).text().includes('Descriere'); }).last().parent().html();
console.log('Descriptions HTML:', descText);

const phoneHref = $('a[href^="tel:"]').attr('href');
console.log('Phones:', phoneHref);
