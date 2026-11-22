import { sdk } from './sdk'

export const uiPort = 9000 as const

// Host id (the `sdk.MultiHost.of` group) and the interface exported on it.
export const mainHostId = 'main'
export const webuiInterfaceId = 'webui'

// Mealie keeps everything it persists under /app/data. Mount the volume root,
// not a subpath: the image's entrypoint runs `chown -R 911:911 /app` as root
// on every start and then drops to that user, which only works on a directory
// the subcontainer's root owns.
export const DATA_MOUNT = '/app/data' as const

export const dataMount = sdk.Mounts.of().mountVolume({
  volumeId: 'main',
  subpath: null,
  mountpoint: DATA_MOUNT,
  readonly: false,
})

export const defaultTimezone = 'UTC'

// AI connector (MCP server)
export const mcpPort = 8000 as const
export const mcpHostId = 'mcp'
export const mcpInterfaceId = 'mcp'

export const mcpMount = sdk.Mounts.of().mountVolume({
  volumeId: 'mcp',
  subpath: null,
  mountpoint: '/data',
  readonly: false,
})
