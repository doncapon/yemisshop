import 'dotenv/config';
export const env = {
  port: Number(process.env.PORT ?? 8080),
  jwtSecret: process.env.JWT_SECRET ?? 'change-me'
};
