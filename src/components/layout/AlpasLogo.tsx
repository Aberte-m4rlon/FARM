import { useNavigate } from 'react-router-dom';
import { AlpasFarmLogo } from '../common/AlpasFarmLogo';

interface AlpasLogoProps {
  collapsed?: boolean;
  className?: string;
  onClick?: () => void;
}

export function AlpasLogo({ collapsed = false, className = '', onClick }: AlpasLogoProps) {
  const navigate = useNavigate();

  const handleClick = () => {
    if (onClick) {
      onClick();
    } else {
      navigate('/dashboard');
    }
  };

  if (collapsed) {
    return (
      <AlpasFarmLogo
        variant="emblem"
        className={className}
        onClick={handleClick}
      />
    );
  }

  return (
    <AlpasFarmLogo
      size="sidebar"
      className={className}
      onClick={handleClick}
      style={{ maxWidth: 180 }}
    />
  );
}

export { AlpasFarmLogo };
export default AlpasLogo;
