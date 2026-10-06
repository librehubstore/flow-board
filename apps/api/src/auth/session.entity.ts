export interface Session {
  _id: string; // sha256 du jeton du cookie
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  userAgent: string;
  ip: string;
}

/** Jeton à usage unique envoyé par email (validation du compte), stocké haché. */
export interface EmailToken {
  _id: string; // sha256 du jeton
  userId: string;
  purpose: 'verify';
  expiresAt: Date;
}

export interface LoginAttempt {
  _id: string; // identifiant|ip
  count: number;
  expiresAt: Date;
}
