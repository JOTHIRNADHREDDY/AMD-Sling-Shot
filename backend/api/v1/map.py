from fastapi import APIRouter

from schemas.api_models import MapDirectionResponse, RouteStep

router = APIRouter()

@router.get("/directions", response_model=MapDirectionResponse)
async def get_directions(from_node: str, to_node: str):
    """
    Dijkstra-based pathfinding result for interactive wayfinder.
    """
    # Mocking Dijkstra pathfinding as per architecture
    return MapDirectionResponse(
        from_node=from_node,
        to_node=to_node,
        total_distance_meters=150,
        estimated_time_mins=3,
        steps=[
            RouteStep(instruction="Walk straight down the hall.", distance_meters=50, direction="straight"),
            RouteStep(instruction="Turn left at the reception.", distance_meters=20, direction="left"),
            RouteStep(instruction="Take the elevator to floor 2.", distance_meters=10, direction="elevator_up"),
            RouteStep(instruction="Walk down the corridor.", distance_meters=70, direction="straight"),
        ]
    )
