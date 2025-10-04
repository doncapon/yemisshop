import { Link } from 'react-router-dom'


export default function Cart() {
  const raw = localStorage.getItem('cart')
  const cart: any[] = raw ? JSON.parse(raw) : []
  const total = cart.reduce((s, it) => s + it.priceMinor * it.qty, 0)


  return (
    <div>
    <h1 className="text-xl mb-4">Your Cart</h1>
    {cart.length === 0 ? (
    <p>Cart is empty. <Link className="underline" to="/">Go shopping</Link></p>
    ) : (
    <>
    <ul className="space-y-2">
    {cart.map((it) => (
    <li key={it.productId} className="flex justify-between border p-2 rounded">
    <span>{it.title} × {it.qty}</span>
    <span>₦{(it.priceMinor * it.qty / 100).toFixed(2)}</span>
    </li>
    ))}
    </ul>
    <div className="mt-4 flex justify-between font-medium">
    <span>Total</span>
    <span>₦{(total / 100).toFixed(2)}</span>
    </div>
    <Link to="/checkout" className="inline-block mt-4">Proceed to Checkout</Link>
    </>
    )}
    </div>
  )
}