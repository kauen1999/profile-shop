const express = require('express');
const { prisma } = require('../db');
const { admin } = require('../firebaseAdmin');
const { asyncHandler } = require('../asyncHandler');

const router = express.Router();

router.post(
  '/google',
  asyncHandler(async (req, res) => {
    const { idToken } = req.body || {};

    if (!idToken || typeof idToken !== 'string') {
      return res.status(401).json({ error: 'idToken ausente ou inválido.' });
    }

    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(idToken);
    } catch (err) {
      console.error('Falha ao verificar idToken do Firebase:', err.message);
      return res.status(401).json({ error: 'Token de autenticação inválido ou expirado.' });
    }

    // DecodedIdToken (o retorno de verifyIdToken) traz `name`/`picture` como
    // claims do provedor Google, não `displayName`/`photoURL` (esses são do
    // objeto client-side `User` do Firebase Auth, formato diferente).
    const { uid, email, name, picture } = decoded;

    if (!email) {
      return res
        .status(401)
        .json({ error: 'Conta Google sem email associado — não é possível autenticar.' });
    }

    let user = await prisma.user.findUnique({ where: { firebaseUid: uid } });

    if (!user) {
      // Pode já existir uma linha com esse email vinda de outro caminho
      // (hoje não há outro caminho de signup, mas não confiar nisso e
      // tratar o conflito explicitamente em vez de deixar o upsert estourar
      // a constraint @unique de email).
      const existingByEmail = await prisma.user.findUnique({ where: { email } });

      if (existingByEmail) {
        // O idToken já foi verificado acima (admin.auth().verifyIdToken) — o
        // Firebase garante que quem apresentou esse token é dono desse email.
        // Se já existe uma linha com esse email (conta legada sem
        // firebaseUid, ou um firebaseUid desatualizado de um teste/linha
        // antiga), só vincula/atualiza em vez de bloquear com 409 — bloquear
        // aqui não protege contra nada real, só impede o dono legítimo de
        // entrar na própria conta.
        user = await prisma.user.update({
          where: { email },
          data: {
            firebaseUid: uid,
            name: name ?? existingByEmail.name,
            image: picture ?? existingByEmail.image,
            updatedAt: new Date(),
          },
        });
      } else {
        user = await prisma.user.create({
          data: {
            email,
            name: name ?? null,
            image: picture ?? null,
            firebaseUid: uid,
            updatedAt: new Date(),
          },
        });
      }
    } else {
      user = await prisma.user.update({
        where: { firebaseUid: uid },
        data: {
          name: name ?? user.name,
          image: picture ?? user.image,
          updatedAt: new Date(),
        },
      });
    }

    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
    });
  })
);

module.exports = router;
