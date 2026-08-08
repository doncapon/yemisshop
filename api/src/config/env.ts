import 'dotenv/config';
export const env = {
  port: Number(process.env.PORT ?? 8081),
  jwtSecret: process.env.JWT_SECRET ?? 'change-me'
};
