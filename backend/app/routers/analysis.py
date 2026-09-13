from fastapi import APIRouter, HTTPException

from app.schemas import AnalysisRequest

router = APIRouter(prefix="/analysis", tags=["analysis"])


@router.post("")
def run_analysis(request: AnalysisRequest):
    """Optional user-requested geoprocessing (statistics panel, section 8).

    Stubbed pending a decision on which operations to expose first — e.g.
    zonal_stats over a drawn AOI against a raster hazard layer (rasterio +
    rasterstats), or area_by_class over a vector hazard layer (GeoPandas
    dissolve + area calc in a projected CRS, not EPSG:4326).
    """
    raise HTTPException(status_code=501, detail=f"Analysis operation '{request.operation}' not yet implemented")
