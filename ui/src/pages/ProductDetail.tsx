// src/pages/ProductDetail.tsx
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../api/client';
import { useToast } from '../components/ToastProvider';
import { useAuthStore } from '../store/auth';

type Product = {
  id: string;
  title: string;
  description: string;
  price: number;
  imagesJson?: string[];
};

export default function ProductDetail() {
  const { id } = useParams();
  const toast = useToast();
  const { token } = useAuthStore();
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['product', id],
    queryFn: async () => (await api.get(`/api/products/${id}`)).data as Product,
    enabled: !!id,
  });

  // Load my favorites (so the heart reflects state on detail page too)
  const favQuery = useQuery({
    queryKey: ['favorites', 'mine'],
    enabled: !!token,
    queryFn: async () => {
      const { data } = await api.get<{ productIds: string[] }>('/api/favorites/mine', {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      return new Set(data.productIds);
    },
    initialData: new Set<string>(),
  });

  const toggleFav = useMutation({
    mutationFn: async ({ productId }: { productId: string }) => {
      const { data } = await api.post<{ favorited: boolean }>(
        '/api/favorites/toggle',
        { productId },
        token ? { headers: { Authorization: `Bearer ${token}` } } : undefined
      );
      return { productId, favorited: data.favorited };
    },
    onMutate: async ({ productId }) => {
      const key = ['favorites', 'mine'] as const;
      const prev = qc.getQueryData<Set<string>>(key);
      if (prev) {
        const next = new Set(prev);
        if (next.has(productId)) next.delete(productId);
        else next.add(productId);
        qc.setQueryData(key, next);
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['favorites', 'mine'], ctx.prev);
      toast.push({ title: 'Wishlist', message: 'Could not update wishlist. Please try again.', duration: 3500 });
    },
    onSuccess: ({ favorited }) => {
      toast.push({
        title: 'Wishlist',
        message: favorited ? 'Added to wishlist.' : 'Removed from wishlist.',
        duration: 2500,
      });
    },
  });

  if (isLoading) return <p>Loading…</p>;
  if (error || !data) return <p>Failed to load product</p>;

  const p = data;
  const fav = !!favQuery.data?.has(p.id);

  const addToCart = () => {
    const raw = localStorage.getItem('cart');
    const cart: any[] = raw ? JSON.parse(raw) : [];
    const idx = cart.findIndex((x) => x.productId === p.id);
    if (idx >= 0) cart[idx].qty += 1;
    else cart.push({ productId: p.id, title: p.title, price: Number(p.price) || 0, qty: 1 });
    localStorage.setItem('cart', JSON.stringify(cart));

    toast.push({
      title: 'Added to cart',
      message: `${p.title} has been added to your cart.`,
      duration: 5000,
    });
  };

  return (
    <div className="grid md:grid-cols-2 gap-6">
      {/* LEFT: image carousel */}
      <div className="w-full">
        <ImageCarousel images={p.imagesJson ?? []} title={p.title} />
      </div>

      {/* RIGHT: product details */}
      <div className="bg-primary-50/60 py-4 px-6 rounded-lg">
        <div className="flex items-start justify-between">
          <h1 className="text-2xl font-semibold text-primary-700 mb-2">{p.title}</h1>
          <button
            aria-label={fav ? 'Remove from wishlist' : 'Add to wishlist'}
            className={`text-2xl ${fav ? 'text-red-600' : 'text-gray-500 hover:text-red-600'}`}
            onClick={() => {
              if (!token) {
                toast.push({ title: 'Login required', message: 'Please login to use wishlist.', duration: 3500 });
                return;
              }
              toggleFav.mutate({ productId: p.id });
            }}
            title={fav ? 'Remove from wishlist' : 'Add to wishlist'}
          >
            {fav ? '♥' : '♡'}
          </button>
        </div>

        <p className="text-xl font-semibold mb-4">₦{Number(p.price || 0).toFixed(2)}</p>

        <h2 className="font-semibold text-primary-600 mb-1">Description</h2>
        <p className="opacity-80 mb-6">{p.description}</p>

        <div className="flex items-center gap-4">
          <button
            className="inline-flex items-center gap-2 rounded-md border bg-accent-500 px-4 py-2 text-white hover:bg-accent-600 transition"
            onClick={addToCart}
          >
            Add to Cart
          </button>
          <Link to="/cart" className="text-md border-b-2">
            Go to cart
          </Link>
          <Link to="/wishlist" className="text-md border-b-2">
            View wishlist
          </Link>
        </div>
      </div>
    </div>
  );
}

/* ===================== */
/* Inline Carousel Comp. */
/* ===================== */
function ImageCarousel({ images, title }: { images: string[]; title: string }) {
  if (!images || images.length === 0) {
    return (
      <div className="w-full max-w-2xl aspect-square md:aspect-[4/3] rounded-lg border overflow-hidden grid place-items-center text-sm text-gray-500 bg-gray-50">
        No images
      </div>
    );
  }

  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (paused || images.length <= 1) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % images.length), 4000);
    return () => clearInterval(t);
  }, [paused, images.length]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let startX = 0;
    let moved = false;

    const onTouchStart = (e: TouchEvent) => {
      startX = e.touches[0].clientX;
      moved = false;
    };
    const onTouchMove = (e: TouchEvent) => {
      const dx = e.touches[0].clientX - startX;
      if (Math.abs(dx) > 10) moved = true;
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (!moved) return;
      const dx = e.changedTouches[0].clientX - startX;
      if (dx < -30) setIdx((i) => (i + 1) % images.length);
      if (dx > 30) setIdx((i) => (i - 1 + images.length) % images.length);
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [images.length]);

  const goPrev = () => setIdx((i) => (i - 1 + images.length) % images.length);
  const goNext = () => setIdx((i) => (i + 1) % images.length);

  return (
    <div
      ref={containerRef}
      className="relative w-full max-w-2xl aspect-square md:aspect-[4/3] rounded-lg border overflow-hidden bg-white"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      aria-roledescription="carousel"
    >
      <div
        className="h-full w-full flex transition-transform duration-500"
        style={{ transform: `translateX(-${idx * 100}%)` }}
      >
        {images.map((src, i) => (
          <div key={src + i} className="min-w-full h-full grid place-items-center bg-white">
            <img
              src={src}
              alt={`${title} – image ${i + 1}`}
              className="max-h-full max-w-full object-contain"
              draggable={false}
            />
          </div>
        ))}
      </div>

      {images.length > 1 && (
        <>
          <button
            aria-label="Previous image"
            onClick={goPrev}
            className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 text-white w-9 h-9 grid place-items-center hover:bg-black/70"
          >
            ‹
          </button>
          <button
            aria-label="Next image"
            onClick={goNext}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 text-white w-9 h-9 grid place-items-center hover:bg-black/70"
          >
            ›
          </button>
        </>
      )}

      {images.length > 1 && (
        <div className="absolute bottom-2 left-0 right-0 flex items-center justify-center gap-2">
          {images.map((_, i) => (
            <button
              key={i}
              onClick={() => setIdx(i)}
              aria-label={`Go to slide ${i + 1}`}
              className={`h-2.5 w-2.5 rounded-full transition ${
                idx === i ? 'bg-primary-500' : 'bg-black/30 hover:bg-black/50'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
