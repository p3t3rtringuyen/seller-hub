"use client";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import { useShellSession } from "../../../app/(shell)/session";
import { copy } from "@/lib/copy";

const t = copy("platform-auth.platform-auth");

/** Header slot (declared by the shell): who is signed in, and Sign out. */
function SignOut() {
  const { me, signOut } = useShellSession();
  if (!me) return null;
  return (
    <>
      <Typography
        variant="body2"
        color="text.secondary"
        data-testid="current-user"
        sx={{ display: { xs: "none", sm: "block" } }}
      >
        {me.user.email}
      </Typography>
      <Button size="small" onClick={() => void signOut()} data-testid="signout">
        {t("nav.signOut")}
      </Button>
    </>
  );
}

export default { slot: "shell.header.actions", component: SignOut, order: 900 };
