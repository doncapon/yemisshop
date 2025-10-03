import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import api from '../api/client'


export default function ProductDetail() {
const { id } = useParams()
const { data, isLoading, error } = useQuery({
queryKey: ['product', id],
queryFn: async () => (await api.get(`/api/products/${id}`)).data,
})


if (isLoading) return <p>Loading…</p>
if (error) return <p>Failed to load product</p>


const p = data!
return (
<div className="grid md:grid-cols-2 gap-6">
<div>
{p.imagesJson?.[0] && <img src={p.imagesJson[0]} alt={p.title} className="w-full max-w-lg" />}
</div>
<div>
<h1 className="text-2xl font-semibold">{p.title}</h1>
<p className="opacity-80 my-3">{p.description}</p>
<p className="text-xl">₦{(p.priceMinor / 100).toFixed(2)}</p>
<button className="mt-4" onClick={() => addToCart(p)}>Add to Cart</button>
</div>
</div>
)
}


function addToCart(p: any) {
const raw = localStorage.getItem('cart')
const cart: any[] = raw ? JSON.parse(raw) : []
const idx = cart.findIndex((x) => x.productId === p.id)
if (idx >= 0) cart[idx].qty += 1
else cart.push({ productId: p.id, title: p.title, priceMinor: p.priceMinor, qty: 1 })
localStorage.setItem('cart', JSON.stringify(cart))
alert('Added to cart')
}