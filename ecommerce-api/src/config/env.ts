import 'dotenv/config';
export const env = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: process.env.JWT_SECRET ?? 'change-me',
  waToken: process.env.WHATSAPP_TOKEN ?? '',
  waPhoneId: process.env.WHATSAPP_PHONE_ID ?? ''
};
