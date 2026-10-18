// Landing page so the deployment root isn't a 404. The real surface is
// POST /api/chat, called by the TrophyShelf mobile app.
export default function Home() {
  return (
    <main>
      <h1>TrophyShelf Librarian</h1>
      <p>This service powers the in-app book assistant. There is nothing to see here.</p>
    </main>
  );
}
