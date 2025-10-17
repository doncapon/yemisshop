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
  stock: boolean;
  price: number;
  imagesJson?: string[];
};

const ngn = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  maximumFractionDigits: 2,
});

export default function ProductDetail() {
  const { id } = useParams();
  const toast = useToast();
  const { token } = useAuthStore();
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['product', id],
    queryFn: async () => (await api.get(`/api/products/${id}`)).data as Product,
    enabled: !!id,
    staleTime: 30_000,
  });

  // My favorites
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
        next.has(productId) ? next.delete(productId) : next.add(productId);
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

  const addToCart = () => {
    if (!data) return;
    const p = data;
    const raw = localStorage.getItem('cart');
    const cart: any[] = raw ? JSON.parse(raw) : [];
    const idx = cart.findIndex((x) => x.productId === p.id);

    // store totalPrice for current qty (back-compat: also keep price)
    if (idx >= 0) {
      const currentQty = Math.max(1, Number(cart[idx].qty) || 1) + 1;
      const unit = Number(p.price) || 0;
      cart[idx] = {
        ...cart[idx],
        qty: currentQty,
        price: unit, // legacy
        totalPrice: unit * currentQty,
        title: p.title,
      };
    } else {
      const unit = Number(p.price) || 0;
      cart.push({
        productId: p.id,
        title: p.title,
        qty: 1,
        price: unit,          // legacy support
        totalPrice: unit * 1, // new preferred field
      });
    }
    localStorage.setItem('cart', JSON.stringify(cart));

    toast.push({
      title: 'Added to cart',
      message: `${p.title} has been added to your cart.`,
      duration: 5000,
    });
  };

  // Loading state (skeleton)
  if (isLoading) {
    return (
      <div className="relative bg-gradient-to-b from-primary-50/60 via-bg-soft to-bg-soft overflow-hidden rounded-2xl p-4 md:p-6">
        <div className="grid md:grid-cols-2 gap-6 animate-pulse">
          <div className="aspect-square md:aspect-[4/3] rounded-2xl bg-white/60 border" />
          <div className="space-y-4">
            <div className="h-8 w-3/4 rounded bg-white/70" />
            <div className="h-6 w-1/3 rounded bg-white/70" />
            <div className="h-24 w-full rounded bg-white/60" />
            <div className="h-11 w-48 rounded bg-white/80" />
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !data) {
    return (
      <div className="min-h-[40vh] grid place-items-center bg-hero-radial bg-bg-soft rounded-2xl">
        <div className="text-center max-w-md">
          <div className="inline-flex items-center gap-2 rounded-full bg-danger/10 text-danger px-3 py-1 text-[11px] font-semibold border border-danger/20">
            Couldn’t load product
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-ink">Please try again</h2>
          <p className="text-ink-soft">Check your connection or go back to the catalogue.</p>
          <Link to="/" className="mt-4 inline-flex items-center rounded-xl border px-4 py-2 hover:bg-black/5">
            Back to products
          </Link>
        </div>
      </div>
    );
  }

  const p = data;
  const fav = !!favQuery.data?.has(p.id);

  return (
    <div className="relative bg-gradient-to-b from-primary-50/60 via-bg-soft to-bg-soft rounded-2xl p-4 md:p-6 overflow-hidden">
      {/* decorative blobs */}
      <div className="pointer-events-none absolute -top-20 -left-24 size-80 rounded-full bg-primary-500/20 blur-3xl animate-pulse" />
      <div className="pointer-events-none absolute -bottom-24 -right-24 size-96 rounded-full bg-fuchsia-400/20 blur-3xl animate-[pulse_6s_ease-in-out_infinite]" />

      <div className="relative grid md:grid-cols-2 gap-6">
        {/* LEFT: image carousel */}
        <div className="w-full">
          <ImageCarousel images={p.imagesJson ?? []} title={p.title} />
        </div>

        {/* RIGHT: product details (glassy card) */}
        <div className="rounded-2xl border border-white/60 bg-white/70 backdrop-blur p-5 md:p-6 shadow-[0_6px_30px_rgba(0,0,0,0.06)]">
          <div className="flex items-start justify-between gap-3">
            {p.stock && (<div className="min-w-0">
              <span className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-primary-600 to-fuchsia-600 text-white px-3 py-1 text-[11px] font-semibold shadow-sm">
                <span className="inline-block size-1.5 rounded-full bg-white/90" />
                In stock
              </span>
              <h1 className="mt-3 text-2xl md:text-3xl font-extrabold tracking-tight text-ink">{p.title}</h1>
            </div>)}

            <button
              aria-label={fav ? 'Remove from wishlist' : 'Add to wishlist'}
              className={`shrink-0 grid place-items-center w-11 h-11 rounded-full border transition
                          ${fav ? 'bg-red-100 text-red-600 border-red-200' : 'bg-white text-ink-soft hover:text-red-600 hover:border-red-300'}`}
              onClick={() => {
                if (!token) {
                  toast.push({ title: 'Login required', message: 'Please login to use wishlist.', duration: 3500 });
                  return;
                }
                toggleFav.mutate({ productId: p.id });
              }}
              title={fav ? 'Remove from wishlist' : 'Add to wishlist'}
            >
              <span className="text-xl">{fav ? '♥' : '♡'}</span>
            </button>
          </div>

          <p className="mt-2 text-2xl font-extrabold tracking-tight text-ink">{ngn.format(Number(p.price) || 0)}</p>

          <div className="mt-4">
            <h2 className="font-semibold text-ink">Description</h2>
            <p className="mt-1 text-ink-soft leading-relaxed">{p.description}</p>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-primary-600 to-fuchsia-600 text-white px-5 py-3 font-semibold shadow-sm hover:shadow-md active:scale-[0.99] focus:outline-none focus:ring-4 focus:ring-primary-200 transition"
              onClick={addToCart}
            >
              Add to cart
            </button>

            <Link
              to="/cart"
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-white px-5 py-3 text-ink hover:bg-black/5 focus:outline-none focus:ring-4 focus:ring-primary-50 transition"
            >
              Go to cart
            </Link>

            <Link
              to="/wishlist"
              className="inline-flex items-center gap-2 text-primary-700 hover:underline"
            >
              View wishlist
            </Link>
          </div>
           <Link
              to="/catalog"
              className="inline-flex items-center gap-2 text-primary-700 hover:underline mt-20"
            >
              Back to catalogue
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
      <div className="w-full max-w-2xl aspect-square md:aspect-[4/3] rounded-2xl border overflow-hidden grid place-items-center text-sm text-ink-soft bg-white/70 backdrop-blur">
        No images
      </div>
    );
  }

  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [zooming, setZooming] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgAreaRef = useRef<HTMLDivElement | null>(null);
  const zoomPaneRef = useRef<HTMLDivElement | null>(null);

  // rAF smoothing refs
  const frameRef = useRef<number | null>(null);
  const targetPosRef = useRef<{ x: number; y: number }>({ x: 50, y: 50 });
  const currentPosRef = useRef<{ x: number; y: number }>({ x: 50, y: 50 });

  const ZOOM = 2.8;          // magnification
  const PANE_REM = 28;       // 2× bigger
  const GAP_PX = 16;         // gap from the image to the pane

  // Auto-advance
  useEffect(() => {
    if (paused || images.length <= 1) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % images.length), 4000);
    return () => clearInterval(t);
  }, [paused, images.length]);

  // Touch swipe
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

  // Update zoom pane background when slide changes
  useEffect(() => {
    const pane = zoomPaneRef.current;
    if (!pane) return;
    pane.style.backgroundImage = `url(${images[idx]})`;
    pane.style.backgroundRepeat = 'no-repeat';
    pane.style.backgroundSize = `${ZOOM * 100}%`;
  }, [idx, images]);

  // Position the pane at the right edge of the image (fixed so it can overlap description)
  const positionPane = () => {
    const pane = zoomPaneRef.current;
    const container = containerRef.current;
    if (!pane || !container) return;

    const rect = container.getBoundingClientRect();

    // Compute size in px from rem
    const paneSizePx = PANE_REM * parseFloat(getComputedStyle(document.documentElement).fontSize);

    // Ideal position: to the right of the image, vertically centered to the image
    let left = rect.right + GAP_PX;
    let top = rect.top + (rect.height - paneSizePx) / 2;

    // Clamp inside viewport with small margin
    const margin = 8;
    left = Math.min(Math.max(margin, left), window.innerWidth - paneSizePx - margin);
    top = Math.min(Math.max(margin, top), window.innerHeight - paneSizePx - margin);

    pane.style.left = `${left}px`;
    pane.style.top = `${top}px`;
    pane.style.width = `${paneSizePx}px`;
    pane.style.height = `${paneSizePx}px`;
  };

  useEffect(() => {
    if (!zooming) return;
    positionPane();
    const onWin = () => positionPane();
    window.addEventListener('resize', onWin);
    window.addEventListener('scroll', onWin, { passive: true });
    return () => {
      window.removeEventListener('resize', onWin);
      window.removeEventListener('scroll', onWin);
    };
  }, [zooming]);

  // rAF loop for smooth lerp toward targetPos
  useEffect(() => {
    const pane = zoomPaneRef.current;
    if (!pane) return;

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const animate = () => {
      const cur = currentPosRef.current;
      const tgt = targetPosRef.current;
      const SMOOTH = 0.2;
      const nx = lerp(cur.x, tgt.x, SMOOTH);
      const ny = lerp(cur.y, tgt.y, SMOOTH);
      currentPosRef.current = { x: nx, y: ny };
      pane.style.backgroundPosition = `${nx}% ${ny}%`;
      frameRef.current = requestAnimationFrame(animate);
    };
    frameRef.current = requestAnimationFrame(animate);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, []);

  // Mouse tracking → update target only; rAF handles smoothing
  const onMouseMove = (e: React.MouseEvent) => {
    const el = imgAreaRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    targetPosRef.current = { x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) };
  };

  return (
    <div className="space-y-3">
      <div
        ref={containerRef}
        className="relative w-full max-w-2xl aspect-square md:aspect-[4/3] rounded-2xl border overflow-hidden bg-white shadow-[0_6px_30px_rgba(0,0,0,0.06)]"
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
            <div key={src + i} className="min-w-full h-full grid place-items-center bg-white relative">
              <div
                ref={i === idx ? imgAreaRef : null}
                className="absolute inset-0"
                onMouseEnter={() => { setZooming(true); positionPane(); }}
                onMouseLeave={() => setZooming(false)}
                onMouseMove={onMouseMove}
              />
              <img
                src={src}
                alt={`${title} – image ${i + 1}`}
                className="max-h-full max-w-full object-contain pointer-events-none select-none"
                draggable={false}
              />
            </div>
          ))}
        </div>

        {/* Controls */}
        {images.length > 1 && (
          <>
            <button
              aria-label="Previous image"
              onClick={goPrev}
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 text-white w-9 h-9 grid place-items-center hover:bg-black/70 focus:outline-none focus:ring-2 focus:ring-white/70"
            >
              ‹
            </button>
            <button
              aria-label="Next image"
              onClick={goNext}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 text-white w-9 h-9 grid place-items-center hover:bg-black/70 focus:outline-none focus:ring-2 focus:ring-white/70"
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
                className={`h-2.5 w-2.5 rounded-full transition ${idx === i ? 'bg-primary-500 scale-110' : 'bg-black/30 hover:bg-black/50'}`}
              />
            ))}
          </div>
        )}
      </div>

      {/* Thumbnails */}
      {images.length > 1 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {images.map((src, i) => (
            <button
              key={'thumb-' + i}
              onClick={() => setIdx(i)}
              className={`h-16 w-16 rounded-lg border overflow-hidden shrink-0 focus:outline-none ${idx === i ? 'ring-2 ring-primary-400' : 'opacity-80 hover:opacity-100'}`}
            >
              <img src={src} alt={`Thumbnail ${i + 1}`} className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}

      {/* FIXED Zoom Pane — sits at page edge, can overlap description */}
      <div
        ref={zoomPaneRef}
        aria-hidden={!zooming}
        className={`hidden md:block fixed z-40 rounded-xl border bg-white/90 backdrop-blur shadow-xl overflow-hidden transition
                    ${zooming ? 'opacity-100 visible' : 'opacity-0 invisible'}`}
        style={{
          // width/height/left/top are set dynamically in positionPane()
          backgroundPosition: '50% 50%',
          backgroundSize: `${ZOOM * 100}%`,
        }}
      />
    </div>
  );
}
