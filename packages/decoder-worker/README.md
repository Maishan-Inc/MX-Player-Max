# @mx-player-max/decoder-worker

Backend-neutral Worker protocol, controller, and main-thread adapter for video decoders. Concrete decoder packages supply the backend configuration, adapter factory, and stable error policy.

The control plane owns session identity, seek epochs, request matching, frame transfer, bounded control operations, stale-frame disposal, flush, reset, and close behavior. It does not decode codecs or inspect browser brands.
