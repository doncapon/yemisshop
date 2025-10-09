import { useServerWishlist } from '../hooks/useServerWishlist';

export default function WishlistButton({ productId }: { productId: string }) {
  const { ready, liked, toggle } = useServerWishlist(productId);

  return (
    <button
      disabled={!ready}
      onClick={toggle}
      className={`rounded-md border px-3 py-1.5 text-sm transition ${
        liked ? 'bg-accent-600 text-white hover:bg-accent-700' : 'hover:bg-black/5'
      }`}
      title={liked ? 'Remove from wishlist' : 'Add to wishlist'}
    >
      {liked ? '♥ Wishlisted' : '♡ Wishlist'}
    </button>
  );
}
