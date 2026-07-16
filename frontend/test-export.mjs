import { buildStoreExportText } from './src/domain/buildExportText.js';

const store = await fetch('http://localhost:3000/stores/teste').then(r => r.json());
const text = buildStoreExportText(store);
console.log(text);
