import { HashRouter, Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import MovieDetail from "./pages/MovieDetail";
import ActorDetail from "./pages/ActorDetail";
import VideoGroupDetail from "./pages/VideoGroupDetail";
import Search from "./pages/Search";
import Settings from "./pages/Settings";
import { Toaster } from 'sonner';

function App() {
  return (
    <HashRouter>
      <Toaster theme="dark" position="top-center" richColors />
      <div className="min-h-screen bg-gray-950 text-white">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/movie/:id" element={<MovieDetail />} />
          <Route path="/actor/:name" element={<ActorDetail />} />
          <Route path="/video-group/:id" element={<VideoGroupDetail />} />
          <Route path="/search" element={<Search />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </div>
    </HashRouter>
  );
}

export default App;
