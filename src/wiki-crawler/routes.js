const express = require('express');
const state = require('./state');

const router = express.Router();

router.get('/next', (req, res) => {
  const title = state.getNext();
  if (!title) return res.json({ done: true });
  res.json({ title });
});

router.post('/result', (req, res) => {
  state.recordResult(req.body);
  res.json({ ok: true });
});

router.get('/status', (req, res) => {
  res.json(state.getStatus());
});

module.exports = router;
