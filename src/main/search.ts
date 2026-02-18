export type SearchResult = {
  title: string
  url: string
  snippet: string
}

const provider = process.env.SEARCH_PROVIDER?.toLowerCase()
const braveKey = process.env.BRAVE_API_KEY

export const isSearchEnabled = (): boolean => {
  if (!provider) return true
  if (provider === 'duckduckgo') return true
  if (provider === 'brave') return Boolean(braveKey)
  return false
}

export const searchWeb = async (query: string): Promise<SearchResult[]> => {
  const activeProvider = provider ?? 'duckduckgo'

  if (activeProvider === 'duckduckgo') {
    const url = new URL('https://api.duckduckgo.com/')
    url.searchParams.set('q', query)
    url.searchParams.set('format', 'json')
    url.searchParams.set('no_html', '1')
    url.searchParams.set('no_redirect', '1')

    const response = await fetch(url)
    if (!response.ok) return []

    const data = (await response.json()) as {
      AbstractText?: string
      AbstractURL?: string
      RelatedTopics?: Array<
        | { Text?: string; FirstURL?: string }
        | { Topics?: Array<{ Text?: string; FirstURL?: string }> }
      >
    }

    const flattenedTopics = (data.RelatedTopics ?? []).flatMap((item) => {
      if ('Topics' in item && Array.isArray(item.Topics)) return item.Topics
      return [item]
    })

    const topicResults = flattenedTopics
      .filter((item) => item.Text && item.FirstURL)
      .slice(0, 5)
      .map((item) => ({
        title: (item.Text as string).split(' - ')[0],
        url: item.FirstURL as string,
        snippet: item.Text as string
      }))

    const abstractResult: SearchResult[] =
      data.AbstractText && data.AbstractURL
        ? [
            {
              title: 'DuckDuckGo Instant Answer',
              url: data.AbstractURL,
              snippet: data.AbstractText
            }
          ]
        : []

    return [...abstractResult, ...topicResults].slice(0, 5)
  }

  if (activeProvider === 'brave') {
    if (!braveKey) return []

    const url = new URL('https://api.search.brave.com/res/v1/web/search')
    url.searchParams.set('q', query)
    url.searchParams.set('count', '5')

    const response = await fetch(url, {
      headers: {
        'X-Subscription-Token': braveKey
      }
    })

    if (!response.ok) {
      return []
    }

    const data = (await response.json()) as {
      web?: { results?: Array<{ title?: string; url?: string; description?: string }> }
    }

    const results = data.web?.results ?? []
    return results
      .filter((item) => item.title && item.url)
      .map((item) => ({
        title: item.title as string,
        url: item.url as string,
        snippet: item.description ?? ''
      }))
  }

  return []
}
