import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import api from "../../api/client";

type Props = {
children: React.ReactNode;
};

export default function SupplierOnboardingGuard({ children }: Props) {
const location = useLocation();

const onboardingQ = useQuery({
queryKey: ["supplier", "onboarding-status"],
queryFn: async () => {
const { data } = await api.get("/api/supplier/onboarding-status", {
withCredentials: true,
});
return (data as any)?.data ?? data;
},
staleTime: 60_000,
refetchOnWindowFocus: false,
});

if (onboardingQ.isLoading) {
return ( <div className="min-h-[40vh] flex items-center justify-center text-sm text-zinc-600">
Checking supplier onboarding… </div>
);
}

const onboardingDone = onboardingQ.data?.onboardingDone === true;

if (!onboardingDone) {
return (
<Navigate
to="/supplier/onboarding"
replace
state={{ from: location.pathname }}
/>
);
}

return <>{children}</>;
}
