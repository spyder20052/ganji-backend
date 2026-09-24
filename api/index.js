// Fonction serverless Vercel : délègue toutes les routes à l'application NestJS compilée.
module.exports = require('../dist/serverless.js').default;
