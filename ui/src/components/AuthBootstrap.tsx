import { useEffect, useRef } from "react";
import { useAuthStore } from "../store/auth";

export default function AuthBootstrap() {
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    void useAuthStore.getState().bootstrap();
  }, []);

  return null;
}