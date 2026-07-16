function parseShopTable(html) {
  const regex = /\[\[Arquivo:([^|\]]+)\|link=[^\]]*(?:\|[^\]]*)?\]\]<br>([^<]+?)<br>[\d.,]+\s*oz<br>([\d,]+)\s*([a-zA-Zçãáéíóú. ]+)/g;
  const items = [];
  let match;
  while ((match = regex.exec(html))) {
    items.push({
      file: match[1].trim(),
      name: match[2].trim(),
      price: Number(match[3].replace(/,/g, '')),
      currency: match[4].trim(),
    });
  }
  return items;
}

module.exports = { parseShopTable };
