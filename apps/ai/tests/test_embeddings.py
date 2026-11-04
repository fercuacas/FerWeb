import json
import unittest
import httpx
from ferweb_ai.embeddings import LocalEmbeddings
from ferweb_ai.models import ProviderError
from ferweb_ai.app import create_app


class EmbeddingTests(unittest.IsolatedAsyncioTestCase):
    async def test_local_embeddings_digest_dimensions_and_no_truncation(self):
        observed=[]
        async def handler(request):
            observed.append(str(request.url))
            if request.url.path == "/api/tags":
                return httpx.Response(200,json={"models":[{"name":"local-embed","digest":"digest-v1"}]})
            if request.url.path == "/api/show":
                return httpx.Response(200,json={"capabilities":["embedding"]})
            body=json.loads(request.content)
            self.assertFalse(body["truncate"])
            self.assertEqual(body["input"],["private source"])
            return httpx.Response(200,json={"embeddings":[[0.1,0.2,0.3]]})
        embedder=LocalEmbeddings("http://ollama:11434","local-embed",3,httpx.MockTransport(handler))
        value=await embedder.embed(["private source"])
        self.assertEqual(value["revision"],"digest-v1")
        self.assertEqual(len(value["vectors"][0]),3)
        self.assertTrue(all(url.startswith("http://ollama:11434/") for url in observed))
        mismatch=LocalEmbeddings("http://ollama:11434","local-embed",4,httpx.MockTransport(handler))
        with self.assertRaises(ProviderError):await mismatch.embed(["private source"])

    async def test_disabled_cloud_and_changed_digest_fail_closed(self):
        calls=[]
        async def handler(request):
            calls.append(request.url.path)
            return httpx.Response(200,json={"models":[{"name":"local-embed","digest":"v1","remote_host":"https://cloud.example"}]})
        local=LocalEmbeddings("http://ollama:11434","local-embed",3,httpx.MockTransport(handler))
        with self.assertRaises(ProviderError):await local.embed(["secret"])
        self.assertNotIn('/api/embed',calls)
        calls.clear()
        disabled=LocalEmbeddings("http://ollama:11434","",3,httpx.MockTransport(handler))
        with self.assertRaises(ProviderError):await disabled.embed(["secret"])
        self.assertEqual(calls,[])
        state={"revision":"v1"}
        async def moving(request):
            if request.url.path=="/api/tags":return httpx.Response(200,json={"models":[{"name":"local-embed","digest":state["revision"]}]})
            if request.url.path=="/api/show":return httpx.Response(200,json={"capabilities":["embedding"]})
            state["revision"]="v2"
            return httpx.Response(200,json={"embeddings":[[1,0,0]]})
        moving_model=LocalEmbeddings("http://ollama:11434","local-embed",3,httpx.MockTransport(moving))
        with self.assertRaises(ProviderError):await moving_model.embed(["secret"])

    async def test_internal_embedding_endpoint_authentication_and_input_bounds(self):
        from tests.fake_app import SimulatedEmbeddings
        token="only-for-this-test-12345678901234567890"
        app=create_app(token,{},SimulatedEmbeddings())
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url="http://internal") as client:
            self.assertEqual((await client.get('/embeddings')).status_code,401)
            headers={"Authorization":"Bearer "+token}
            self.assertEqual((await client.get('/embeddings',headers=headers)).json()["dimensions"],8)
            self.assertEqual((await client.post('/embeddings',headers=headers,json={"texts":["cookie"],"provider":"openai"})).status_code,422)
            self.assertEqual((await client.post('/embeddings',headers=headers,json={"texts":["x"*4001]})).status_code,422)
            self.assertEqual((await client.post('/embeddings',headers=headers,json={"texts":["cookie"]})).status_code,200)
