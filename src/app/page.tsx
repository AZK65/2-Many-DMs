import { Inbox } from "@/components/Inbox";
import { UpdateBanner } from "@/components/UpdateBanner";
import { cookies } from "next/headers";
import { isGuestCookie, SHARE_COOKIE } from "@/lib/share-auth";

export default function Page() {
  const readOnly = isGuestCookie(cookies().get(SHARE_COOKIE)?.value);
  return (
    <>
      <Inbox readOnly={readOnly} />

      {!readOnly && <UpdateBanner />}
    </>
  );
}
