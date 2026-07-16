const path = require('path');

module.exports = {
  apiUrl: 'https://wiki.otponline.com/api.php',
  mainPageTitle: 'Página principal',
  dataDir: path.join(__dirname, '../../data/wiki-crawl'),
  get pagesDir() {
    return path.join(this.dataDir, 'pages');
  },
  get indexPath() {
    return path.join(this.dataDir, 'index.json');
  },
  get queuePath() {
    return path.join(this.dataDir, 'queue.json');
  },
};
