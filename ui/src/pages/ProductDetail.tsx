import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../api/client';
import { useToast } from '../components/ToastProvider';

export default function ProductDetail() {
  const { id } = useParams();
  const toast = useToast();
  const { data, isLoading, error } = useQuery({
    queryKey: ['product', id],
    queryFn: async () => (await api.get(`/api/products/${id}`)).data,
  });

  if (isLoading) return <p>Loading…</p>;
  if (error || !data) return <p>Failed to load product</p>;

  const p = data as { id: string; title: string; description: string; price: number; imagesJson?: string[]; };
  const imgSrc = p.imagesJson?.[0];

  const addToCart = () => {
    const raw = localStorage.getItem('cart');
    const cart: any[] = raw ? JSON.parse(raw) : [];
    const idx = cart.findIndex((x) => x.productId === p.id);
    if (idx >= 0) cart[idx].qty += 1;
    else cart.push({ productId: p.id, title: p.title, price: Number(p.price) || 0, qty: 1 });
    localStorage.setItem('cart', JSON.stringify(cart));

    // 🎉 Pretty toast instead of alert
    toast.push({
      title: 'Added to cart',
      message: `${p.title} has been added to your cart.`,
      duration: 5000, // optional (default 5s)
    });
  };

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="w-full">
        <div className="w-full max-w-2xl aspect-square md:aspect-[4/3] rounded-lg border overflow-hidden">
          {imgSrc ? (
            <img src={imgSrc} alt={p.title} className="w-full h-full object-contain block bg-white" />
          ) : (
            <div className="w-full h-full grid place-items-center text-sm text-gray-500 bg-gray-50">No image</div>
          )}
        </div>
      </div>

      <div>
        <h1 className="text-2xl font-semibold">{p.title}</h1>
        <p className="opacity-80 my-3">{p.description}</p>
        <p className="text-xl">₦{Number(p.price || 0).toFixed(2)}</p>
        <button
          className="mt-4 inline-flex items-center gap-2 rounded-md border px-4 py-2 hover:bg-black hover:text-white transition"
          onClick={addToCart}
        >
          Add to Cart
        </button>
      </div>
    </div>
  );
}
