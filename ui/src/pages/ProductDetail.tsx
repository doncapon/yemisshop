import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../api/client';
import { useToast } from '../components/ToastProvider';

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

  const { data, isLoading, error } = useQuery({
    queryKey: ['product', id],
    // 👇 your note: show images in a carousel (done below)
    queryFn: async () => (await api.get(`/api/products/${id}`)).data as Product,
  });

  if (isLoading) return <p>Loading…</p>;
  if (error || !data) return <p>Failed to load product</p>;

  const p = data;

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
        <h1 className="text-2xl font-semibold text-primary-700 mb-4">{p.title}</h1>

        <h2 className="font-semibold text-primary-600 mb-1">Description</h2>
        <p className="opacity-80 mb-6">{p.description}</p>

        <p className="text-xl font-semibold mb-4">₦{Number(p.price || 0).toFixed(2)}</p>

        <button
          className="mt-2 inline-flex items-center gap-2 rounded-md border bg-accent-500 px-4 py-2 text-white hover:bg-accent-600 transition"
          onClick={addToCart}
        >
          Add to Cart
        </button>
        <Link to="/cart" className=" text-md border-b-2 ml-4">Go to cart</Link>
      </div>
    </div>
  );
}

/* ===================== */
/* Inline Carousel Comp. */
/* ===================== */
function ImageCarousel({ images, title }: { images: string[]; title: string }) {
  // If no images, show placeholder
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

  // Auto-advance every 4s
  useEffect(() => {
    if (paused || images.length <= 1) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % images.length), 4000);
    return () => clearInterval(t);
  }, [paused, images.length]);

  // Simple swipe support
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
      if (dx < -30) setIdx((i) => (i + 1) % images.length); // swipe left -> next
      if (dx > 30) setIdx((i) => (i - 1 + images.length) % images.length); // swipe right -> prev
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
      {/* Slides */}
      <div
        className="h-full w-full flex transition-transform duration-500"
        style={{ transform: `translateX(-${idx * 100}%)` }}
      >
        {images.map((src, i) => (
          <div key={src + i} className="min-w-full h-full grid place-items-center bg-white">
            {/* Use object-contain to keep product centered */}
            <img
              src={src}
              alt={`${title} – image ${i + 1}`}
              className="max-h-full max-w-full object-contain"
              draggable={false}
            />
          </div>
        ))}
      </div>

      {/* Arrows */}
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

      {/* Dots */}
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
