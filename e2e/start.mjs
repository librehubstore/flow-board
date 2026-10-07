// Serveur de recette : vide la base dédiée, puis démarre l'application construite.
import { MongoClient } from 'mongodb';
import { createRequire } from 'node:module';

const client = await MongoClient.connect(process.env.MONGO_URL);
await client.db().dropDatabase();
await client.close();
createRequire(import.meta.url)('../apps/api/dist/main.js').bootstrap();
