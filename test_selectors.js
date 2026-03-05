const fs = require('fs');
const cheerio = require('cheerio');
const html = fs.readFileSync('immoflux_slidepanel.html', 'utf8');
const $ = cheerio.load(html);

function findElementWithText(text) {
    const els = $(`*:contains("${text}")`).last();
    let curr = els;
    while (curr.length) {
        if (curr.text().trim().includes(text) && curr.children().length <= 1) break;
        curr = curr.parent();
    }
    if (!els.length) return 'Not found';
    return `Tag: ${els[0].name}, Class: ${els.attr('class')}, HTML: ${$.html(els.parent())}`;
}

const findTextRegex = (regex) => {
    let result = '';
    $('*').each((i, el) => {
        if ($(el).text().match(regex) && $(el).children().length === 0) {
            result = `Tag: ${el.name}, Class: $(el).attr('class'), Text: ${$(el).text().trim()}`;
        }
    });
    return result;
};

console.log('--- SEARCHING DOM FOR KEYWORKS ---');
console.log('Price (€):', findElementWithText('€'));
console.log('Price (EUR):', findElementWithText('EUR'));
console.log('Rooms (Camere):', findElementWithText('Camere'));
console.log('Location (Zona):', findElementWithText('Zona'));
console.log('Phone (07):', findTextRegex(/^07[0-9]{8}$/));
console.log('Description (inchiriez):', findElementWithText('inchiriez'));
