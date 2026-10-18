import { IMAGES } from './sceneData';
import { PHONE, PHONE_SIZES, srcSetOf } from './photos';

// One capture as a responsive picture: the phone crop under PHONE, the desktop crop otherwise.
// Proportions come from CSS per screen size (marketing.css): a picture that has just mounted is
// measured (for the motion) before the browser has chosen between the phone and desktop crops.
const Picture = ({ photo, sizes, alt = photo.alt, eager = false, className, imageProps, pictureRef }) => (
  <picture
    ref={pictureRef}
    className={className}
    style={{
      '--mx-ratio': `${photo.width} / ${photo.height}`,
      '--mx-ratio-phone': `${photo.phone.width} / ${photo.phone.height}`,
    }}
  >
    <source media={PHONE} srcSet={srcSetOf(photo.phone)} sizes={PHONE_SIZES} width={photo.phone.width} height={photo.phone.height} />
    <img
      src={`${IMAGES}/${photo.src}.webp`}
      srcSet={srcSetOf(photo)}
      sizes={sizes}
      width={photo.width}
      height={photo.height}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      fetchPriority={eager ? 'high' : 'auto'}
      decoding="async"
      {...imageProps}
    />
  </picture>
);

export default Picture;
