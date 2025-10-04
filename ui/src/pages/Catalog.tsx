import { useQuery } from '@tanstack/react-query'
import api from '../api/client'
import { Link } from 'react-router-dom'


type Product = {
id: string
title: string
description: string
priceMinor: number
imagesJson: string[] | null
}


export default function Catalog() {
  const { data, isLoading, error } = useQuery({
  queryKey: ['products'],
  queryFn: async () => (await api.get('/api/products')).data as Product[],
  })


  if (isLoading) return <p>Loading…</p>
  if (error) return <p>Error loading products</p>


  return (
    <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
    {data!.map((p) => (
    <article key={p.id} className="border rounded p-3">
    <Link to={`/product/${p.id}`}>
    {p.imagesJson?.[0] && (
    <img src={p.imagesJson[0]} alt={p.title} className="w-full h-40 object-cover mb-2" />
    )}
    <h3 className="font-medium">{p.title}</h3>
    <p className="text-sm opacity-70">₦{(p.priceMinor / 100).toFixed(2)}</p>
    </Link>
    </article>
    ))}
    </div>
  )
}