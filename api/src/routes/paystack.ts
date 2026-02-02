// paystack.ts
import axios from 'axios';
import { PAYSTACK_SECRET_KEY } from '../lib/paystack.js';
const paystack = axios.create({
  baseURL: 'https://api.paystack.co',
  headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` }
});
export default paystack;
