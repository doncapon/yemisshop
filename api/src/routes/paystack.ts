// paystack.ts
import axios from 'axios';
const paystack = axios.create({
  baseURL: 'https://api.paystack.co',
  headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
});
export default paystack;
