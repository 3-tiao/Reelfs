import { useEffect, useState, useCallback } from "react";
import { FixedSizeGrid as Grid } from "react-window";
import MovieCard from "./MovieCard";
import { Movie } from "../services/tauri";

interface MovieGridProps {
  movies: Movie[];
}

export default function MovieGrid({ movies }: MovieGridProps) {
  const [dimensions, setDimensions] = useState({
    width: window.innerWidth,
    height: window.innerHeight - 80,
  });

  const cardWidth = 200;
  const cardHeight = 320;
  const columnCount = Math.floor(dimensions.width / cardWidth);
  const rowCount = Math.ceil(movies.length / columnCount);

  useEffect(() => {
    const handleResize = () => {
      setDimensions({
        width: window.innerWidth,
        height: window.innerHeight - 80,
      });
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const Cell = useCallback(
    ({ columnIndex, rowIndex, style }: any) => {
      const index = rowIndex * columnCount + columnIndex;
      const movie = movies[index];

      if (!movie) return null;

      return (
        <div style={{ ...style, padding: "8px" }}>
          <MovieCard movie={movie} />
        </div>
      );
    },
    [movies, columnCount]
  );

  if (movies.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-400 text-lg">No movies found</p>
      </div>
    );
  }

  return (
    <Grid
      columnCount={columnCount}
      columnWidth={cardWidth}
      height={dimensions.height}
      rowCount={rowCount}
      rowHeight={cardHeight}
      width={dimensions.width}
      overscanRowCount={2}
    >
      {Cell}
    </Grid>
  );
}
