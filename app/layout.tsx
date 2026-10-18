export const metadata = {
  title: "TrophyShelf Librarian API",
  description: "Chat backend for the TrophyShelf app.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "Georgia, serif", margin: 40 }}>{children}</body>
    </html>
  );
}
